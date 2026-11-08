#!/usr/bin/env tsx
/**
 * Replaces `ref_us_places`, the reference data sample points are made from, with
 * the Census gazetteer places file joined to Google's geotargets list. Download and
 * unzip both first:
 *   https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html (Places, national)
 *   https://developers.google.com/google-ads/api/data/geotargets (latest CSV)
 *
 * Usage (never loads .env; point it at the database you mean to load):
 *   cd packages/service
 *   DATABASE_URL=postgres://... pnpm load:reference-places <gazetteer.txt> <geotargets.csv> [--vintage=2025]
 *
 * Existing sample points keep the names they were made with until their area is saved again.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { db } from "@workspace/lib/db/db";
import { refUsPlaces } from "../src/local/schema";
import {
	googleCanonicalName,
	parseGazetteerPlaces,
	parseUsCityGeotargets,
} from "../src/local/service-areas/reference-places";
import { withAgency } from "../src/local/tenancy";

if (!process.env.DATABASE_URL) {
	console.error("Set DATABASE_URL explicitly; this script never reads .env.");
	process.exit(1);
}

const files = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const vintageArg = process.argv.find((arg) => arg.startsWith("--vintage="))?.split("=")[1];
const [gazetteerPath, geotargetsPath] = files;
if (!gazetteerPath || !geotargetsPath) {
	console.error("Usage: load-reference-places <gazetteer places .txt> <geotargets .csv> [--vintage=YYYY]");
	process.exit(1);
}
const vintage = Number(vintageArg ?? basename(gazetteerPath).match(/^(\d{4})_Gaz/)?.[1]);
if (!Number.isInteger(vintage)) {
	console.error("Couldn't tell the gazetteer's vintage from its file name; pass --vintage=YYYY.");
	process.exit(1);
}

const places = parseGazetteerPlaces(readFileSync(gazetteerPath, "utf8"));
const cities = parseUsCityGeotargets(readFileSync(geotargetsPath, "utf8"));
const rows = places.map((place) => ({ ...place, googleCanonicalName: googleCanonicalName(place, cities), vintage }));
const BATCH = 2_000;

try {
	await withAgency({ actor: "load-reference-places", reason: "Replace reference places" }, () =>
		db.transaction(async (tx) => {
			await tx.delete(refUsPlaces);
			for (let i = 0; i < rows.length; i += BATCH) {
				await tx.insert(refUsPlaces).values(rows.slice(i, i + BATCH));
			}
		}),
	);
	const named = rows.filter((row) => row.googleCanonicalName).length;
	console.log(`Loaded ${rows.length} places from the ${vintage} gazetteer; ${named} have a Google canonical name.`);
} finally {
	await db.$client.end();
}
