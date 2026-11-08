#!/usr/bin/env tsx
/**
 * Replaces `ref_us_zctas`, the reference data ZIP grids are made from, with the Census
 * ZCTA gazetteer file and, optionally, total population by ZCTA. Download both first:
 *   https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html (ZCTAs, national)
 *   curl -o dhc-2020-p1-zcta.json 'https://data.census.gov/api/access/data/table?id=DECENNIALDHC2020.P1&g=010XX00US$8600000'
 *
 * Usage (never loads .env; point it at the database you mean to load):
 *   cd packages/service
 *   DATABASE_URL=postgres://... pnpm load:reference-zctas <gazetteer.txt> [population.json] [--vintage=2025] [--population-vintage=2020]
 *
 * Without population, ZIP grids keep the ZCTAs with the most land area instead.
 * Existing sample points keep their ZIPs until their area is saved again.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { db } from "@workspace/lib/db/db";
import { refUsZctas } from "../src/local/schema";
import { parseGazetteerZctas, parseZctaPopulation } from "../src/local/service-areas/reference-zctas";
import { withAgency } from "../src/local/tenancy";

if (!process.env.DATABASE_URL) {
	console.error("Set DATABASE_URL explicitly; this script never reads .env.");
	process.exit(1);
}

const flag = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const [gazetteerPath, populationPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!gazetteerPath) {
	console.error(
		"Usage: load-reference-zctas <gazetteer ZCTA .txt> [population .json] [--vintage=YYYY] [--population-vintage=YYYY]",
	);
	process.exit(1);
}
const vintage = Number(flag("vintage") ?? basename(gazetteerPath).match(/^(\d{4})_Gaz/)?.[1]);
if (!Number.isInteger(vintage)) {
	console.error("Couldn't tell the gazetteer's vintage from its file name; pass --vintage=YYYY.");
	process.exit(1);
}

const zctas = parseGazetteerZctas(readFileSync(gazetteerPath, "utf8"));
const population = populationPath ? parseZctaPopulation(readFileSync(populationPath, "utf8")) : null;
const populationVintage = population ? Number(flag("population-vintage") ?? population.vintage) : null;
if (population && !Number.isInteger(populationVintage)) {
	console.error("Couldn't tell the population table's year; pass --population-vintage=YYYY.");
	process.exit(1);
}
const rows = zctas.map((zcta) => ({
	...zcta,
	population: population?.byZcta.get(zcta.zcta) ?? null,
	vintage,
	populationVintage,
}));
const BATCH = 2_000;

try {
	await withAgency({ actor: "load-reference-zctas", reason: "Replace reference ZCTAs" }, () =>
		db.transaction(async (tx) => {
			await tx.delete(refUsZctas);
			for (let i = 0; i < rows.length; i += BATCH) {
				await tx.insert(refUsZctas).values(rows.slice(i, i + BATCH));
			}
		}),
	);
	const counted = rows.filter((row) => row.population !== null).length;
	console.log(
		`Loaded ${rows.length} ZCTAs from the ${vintage} gazetteer; ${counted} have ${populationVintage ?? "no"} population.`,
	);
} finally {
	await db.$client.end();
}
