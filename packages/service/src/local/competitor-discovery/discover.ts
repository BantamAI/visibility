import { dedupeAliases } from "@workspace/lib/citations/domain-categories";
import { db } from "@workspace/lib/db/db";
import { brands, competitors, promptRuns, prompts } from "@workspace/lib/db/schema";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { type AreaCircle, NEAR_AREA_FACTOR, zipOf } from "../local-mentions/near";
import {
	type AreaCompetitor,
	answerBusinesses,
	answerNamedBusinesses,
	areaCompetitors,
	placeAnchors,
	placeResolutions,
	refUsZctas,
	runLocations,
	samplePoints,
	subjectServiceAreas,
} from "../schema";
import { distanceMeters } from "../service-areas/geo";
import { getDiscoverySettings, listServices } from "./manage";
import { type AreaCandidate, trackedInArea } from "./rank";
import {
	competitorDomain,
	isSubjectName,
	namesByPlace,
	type Sighting,
	serviceRuns,
	tallyServices,
	tallySightings,
} from "./tally";

/** Who anchors the competitors discovery adds, so it removes only its own anchors. */
export const DISCOVERY_ACTOR = "competitor discovery";

/** Answers give a business few names; more would mostly be the model's paraphrases. */
const MAX_ALIASES = 5;

const lower = (name: string) => name.trim().toLowerCase();

interface Area extends AreaCircle {
	id: string;
}

const near = (area: AreaCircle, point: { lat: number; lng: number }) =>
	distanceMeters(area, point) <= area.radiusMeters * NEAR_AREA_FACTOR;

/**
 * The businesses the subject's located runs since `since` name with a listing Google resolved, and
 * the cards in their answers that carry a Place ID and are near the run's area. The map pack beside
 * an AI Overview is Google's ranking, not the AI's, so it's left out.
 */
async function sightingsSince(subjectId: string, areas: Area[], since: Date): Promise<Sighting[]> {
	const located = and(eq(runLocations.subjectId, subjectId), gte(runLocations.createdAt, since));
	const [named, cards] = await Promise.all([
		db
			.select({
				runId: runLocations.runId,
				areaId: samplePoints.areaId,
				tags: prompts.tags,
				placeId: placeResolutions.placeId,
				cid: placeResolutions.cid,
				name: answerNamedBusinesses.name,
				website: answerNamedBusinesses.website,
			})
			.from(answerNamedBusinesses)
			.innerJoin(runLocations, eq(runLocations.runId, answerNamedBusinesses.runId))
			.innerJoin(samplePoints, eq(samplePoints.id, runLocations.pointId))
			.innerJoin(promptRuns, eq(promptRuns.id, runLocations.runId))
			.innerJoin(prompts, eq(prompts.id, promptRuns.promptId))
			.innerJoin(
				placeResolutions,
				and(
					eq(placeResolutions.subjectId, answerNamedBusinesses.subjectId),
					eq(placeResolutions.nameKey, answerNamedBusinesses.nameKey),
					sql`${placeResolutions.phone} IS NOT DISTINCT FROM ${answerNamedBusinesses.phone}`,
					sql`${placeResolutions.address} IS NOT DISTINCT FROM ${answerNamedBusinesses.address}`,
					eq(placeResolutions.resolution, "matched"),
				),
			)
			.where(located),
		db
			.select({
				runId: runLocations.runId,
				areaId: samplePoints.areaId,
				tags: prompts.tags,
				placeId: answerBusinesses.placeId,
				cid: answerBusinesses.cid,
				name: answerBusinesses.name,
				website: answerBusinesses.website,
				address: answerBusinesses.address,
				lat: answerBusinesses.lat,
				lng: answerBusinesses.lng,
			})
			.from(answerBusinesses)
			.innerJoin(runLocations, eq(runLocations.runId, answerBusinesses.runId))
			.innerJoin(samplePoints, eq(samplePoints.id, runLocations.pointId))
			.innerJoin(promptRuns, eq(promptRuns.id, runLocations.runId))
			.innerJoin(prompts, eq(prompts.id, promptRuns.promptId))
			.where(and(located, eq(answerBusinesses.placement, "answer"), isNotNull(answerBusinesses.placeId))),
	]);
	const zips = [...new Set(cards.flatMap((card) => (card.lat === null ? (zipOf(card.address) ?? []) : [])))];
	const zipPoints = new Map(
		(zips.length
			? await db
					.select({ zcta: refUsZctas.zcta, lat: refUsZctas.lat, lng: refUsZctas.lng })
					.from(refUsZctas)
					.where(inArray(refUsZctas.zcta, zips))
			: []
		).map(({ zcta, lat, lng }) => [zcta, { lat, lng }]),
	);
	const areaById = new Map(areas.map((area) => [area.id, area]));
	const nearItsArea = (card: (typeof cards)[number]) => {
		const area = areaById.get(card.areaId);
		const zip = zipOf(card.address);
		const point =
			card.lat !== null && card.lng !== null ? { lat: card.lat, lng: card.lng } : zip ? zipPoints.get(zip) : undefined;
		return area !== undefined && point !== undefined && near(area, point);
	};
	return [
		...named.flatMap(({ placeId, ...sighting }) => (placeId ? [{ ...sighting, placeId }] : [])),
		...cards
			.filter(nearItsArea)
			.map(({ placeId, runId, areaId, tags, cid, name, website }) => ({
				runId,
				areaId,
				tags,
				placeId: placeId as string,
				cid,
				name,
				website,
			})),
	];
}

export interface Discovered {
	tracked: number;
	/** Elmo competitors discovery added. */
	added: string[];
	/** Elmo competitors discovery removed, since no area tracks them any more. */
	removed: string[];
}

/**
 * Counts how often each business is named in the subject's runs in each area, decides which each
 * area tracks, and keeps Elmo's competitors in step: the ones tracked anywhere, under the name they
 * were found by. Runs in the caller's subject scope.
 */
export async function discoverCompetitors(subjectId: string, now = new Date()): Promise<Discovered> {
	const [brand] = await db
		.select({ name: brands.name, aliases: brands.aliases })
		.from(brands)
		.where(eq(brands.id, subjectId))
		.limit(1);
	if (!brand) return { tracked: 0, added: [], removed: [] };
	const [areas, services, settings, anchors, existingCompetitors, existing] = await Promise.all([
		db
			.select({
				id: subjectServiceAreas.id,
				lat: subjectServiceAreas.centerLat,
				lng: subjectServiceAreas.centerLng,
				radiusMeters: subjectServiceAreas.radiusMeters,
			})
			.from(subjectServiceAreas)
			.where(eq(subjectServiceAreas.subjectId, subjectId)),
		listServices(subjectId),
		getDiscoverySettings(subjectId),
		db.select().from(placeAnchors).where(eq(placeAnchors.subjectId, subjectId)),
		db.select({ name: competitors.name }).from(competitors).where(eq(competitors.brandId, subjectId)),
		db.select().from(areaCompetitors).where(eq(areaCompetitors.subjectId, subjectId)),
	]);
	const since = new Date(now.getTime() - settings.windowDays * 86_400_000);
	const subjectPlace = anchors.find((anchor) => anchor.competitorName === null)?.placeId ?? null;
	const sightings = (await sightingsSince(subjectId, areas, since)).filter(
		(sighting) => sighting.placeId !== subjectPlace && !isSubjectName(sighting.name, brand),
	);
	const tallies = tallySightings(
		sightings,
		services.map((service) => service.name),
	);
	const names = namesByPlace(sightings);
	const nameOf = placeNames(existing, anchors, existingCompetitors, names);

	await db.transaction(async (tx) => {
		for (const area of areas) {
			const rows = new Map(existing.filter((row) => row.areaId === area.id).map((row) => [row.placeId, row]));
			const areaTallies = tallies.get(area.id) ?? new Map();
			const candidates: AreaCandidate[] = [...new Set([...rows.keys(), ...areaTallies.keys()])].flatMap((placeId) => {
				const row = rows.get(placeId);
				const tally = areaTallies.get(placeId);
				const name = row?.name ?? nameOf(placeId);
				if (!name) return [];
				return {
					placeId,
					name,
					status: row?.status ?? "auto",
					seedRank: row?.seedRank ?? null,
					answerRuns: tally?.runs.size ?? 0,
					serviceRuns: tally ? serviceRuns(tally) : 0,
					tracked: row?.tracked ?? false,
				};
			});
			const tracked = trackedInArea(candidates, settings);
			for (const candidate of candidates) {
				const row = rows.get(candidate.placeId);
				const tally = areaTallies.get(candidate.placeId);
				// No longer named nor seeded, so it can't be tracked: only a staff decision or Elmo's competitor keeps it.
				if (row && !tally && row.status === "auto" && row.seedRank === null && !row.ownsCompetitor) {
					await tx.delete(areaCompetitors).where(eq(areaCompetitors.id, row.id));
					continue;
				}
				const answered = names.get(candidate.placeId) ?? [];
				const values = {
					answerRuns: candidate.answerRuns,
					tracked: tracked.has(candidate.placeId),
					aliases:
						answered.length > 0
							? answered.filter((name) => lower(name) !== lower(candidate.name)).slice(0, MAX_ALIASES)
							: (row?.aliases ?? []),
					services: [...new Set([...(row?.services ?? []), ...(tally ? tallyServices(tally) : [])])].sort(),
					cid: row?.cid ?? tally?.cid ?? null,
					website: row?.website ?? tally?.website ?? null,
				};
				if (!row) {
					await tx
						.insert(areaCompetitors)
						.values({ subjectId, areaId: area.id, placeId: candidate.placeId, name: candidate.name, ...values });
				} else if (changed(row, values)) {
					await tx.update(areaCompetitors).set(values).where(eq(areaCompetitors.id, row.id));
				}
			}
		}
	});

	const rows = await db.select().from(areaCompetitors).where(eq(areaCompetitors.subjectId, subjectId));
	const synced = await syncCompetitors(subjectId, rows);
	return { tracked: rows.filter((row) => row.tracked).length, ...synced };
}

const sameList = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((value, i) => value === b[i]);

function changed(row: AreaCompetitor, values: Partial<AreaCompetitor>): boolean {
	return Object.entries(values).some(([key, value]) => {
		const current = row[key as keyof AreaCompetitor];
		return Array.isArray(value) && Array.isArray(current) ? !sameList(value, current) : value !== current;
	});
}

/**
 * The name a newly found business is tracked under: a tracked competitor's when it's anchored on the
 * same listing, the name another area found it by, or else how answers most often write it.
 */
export function placeNames(
	existing: AreaCompetitor[],
	anchors: { competitorName: string | null; placeId: string }[],
	elmoCompetitors: { name: string }[],
	answered: Map<string, string[]>,
): (placeId: string) => string | undefined {
	const competitorNames = new Map(elmoCompetitors.map(({ name }) => [lower(name), name]));
	return (placeId) => {
		const anchored = anchors.find((anchor) => anchor.placeId === placeId && anchor.competitorName !== null);
		const competitor = anchored?.competitorName ? competitorNames.get(lower(anchored.competitorName)) : undefined;
		return competitor ?? existing.find((row) => row.placeId === placeId)?.name ?? answered.get(placeId)?.[0];
	};
}

interface Wanted {
	name: string;
	placeId: string;
	cid: string | null;
	domains: string[];
	aliases: string[];
}

/**
 * Makes Elmo's competitors match what the areas track: adds each business tracked somewhere and
 * anchors it on its listing, keeps the domains and aliases of the ones discovery added, and removes
 * those no area tracks any more. Competitors staff added themselves are never changed or removed.
 */
async function syncCompetitors(
	subjectId: string,
	rows: AreaCompetitor[],
): Promise<{ added: string[]; removed: string[] }> {
	const wanted = new Map<string, Wanted>();
	for (const row of [...rows].filter((row) => row.tracked).sort((a, b) => b.answerRuns - a.answerRuns)) {
		const entry = wanted.get(lower(row.name)) ?? {
			name: row.name,
			placeId: row.placeId,
			cid: row.cid,
			domains: [],
			aliases: [],
		};
		const domain = competitorDomain(row.website);
		if (domain && !entry.domains.includes(domain)) entry.domains.push(domain);
		entry.aliases = dedupeAliases([...entry.aliases, ...row.aliases])
			.filter((alias) => lower(alias) !== lower(entry.name))
			.slice(0, MAX_ALIASES);
		wanted.set(lower(row.name), entry);
	}
	const owned = new Set(rows.filter((row) => row.ownsCompetitor).map((row) => lower(row.name)));
	const added: string[] = [];
	const removed: string[] = [];
	const byName = (name: string) => sql`lower(${areaCompetitors.name}) = ${name}`;

	await db.transaction(async (tx) => {
		const current = await tx.select().from(competitors).where(eq(competitors.brandId, subjectId));
		const currentByName = new Map(current.map((competitor) => [lower(competitor.name), competitor]));
		for (const [key, want] of wanted) {
			const have = currentByName.get(key);
			if (have && !owned.has(key)) continue;
			if (!have) {
				await tx
					.insert(competitors)
					.values({ brandId: subjectId, name: want.name, domains: want.domains, aliases: want.aliases });
				added.push(want.name);
			} else if (!sameList(have.domains, want.domains) || !sameList(have.aliases, want.aliases)) {
				await tx
					.update(competitors)
					.set({ domains: want.domains, aliases: want.aliases })
					.where(eq(competitors.id, have.id));
			}
			if (!owned.has(key)) {
				await tx
					.update(areaCompetitors)
					.set({ ownsCompetitor: true })
					.where(and(eq(areaCompetitors.subjectId, subjectId), byName(key)));
			}
			await tx
				.insert(placeAnchors)
				.values({
					subjectId,
					competitorName: want.name,
					placeId: want.placeId,
					cid: want.cid,
					searchQuery: want.name,
					confirmedBy: DISCOVERY_ACTOR,
				})
				.onConflictDoNothing();
		}
		for (const key of owned) {
			if (wanted.has(key)) continue;
			const gone = await tx
				.delete(competitors)
				.where(and(eq(competitors.brandId, subjectId), sql`lower(${competitors.name}) = ${key}`))
				.returning({ name: competitors.name });
			await tx
				.delete(placeAnchors)
				.where(
					and(
						eq(placeAnchors.subjectId, subjectId),
						sql`lower(${placeAnchors.competitorName}) = ${key}`,
						eq(placeAnchors.confirmedBy, DISCOVERY_ACTOR),
					),
				);
			await tx
				.update(areaCompetitors)
				.set({ ownsCompetitor: false })
				.where(and(eq(areaCompetitors.subjectId, subjectId), byName(key)));
			removed.push(...gone.map(({ name }) => name));
		}
	});
	return { added, removed };
}
