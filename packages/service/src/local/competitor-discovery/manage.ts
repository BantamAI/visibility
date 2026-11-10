import { db } from "@workspace/lib/db/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
	type AreaCompetitor,
	areaCompetitors,
	competitorDiscoverySettings,
	type SubjectService,
	subjectServiceAreas,
	subjectServices,
} from "../schema";
import { DEFAULT_DISCOVERY_SETTINGS, type DiscoverySettings } from "./rank";

export class CompetitorDiscoveryError extends Error {
	override name = "CompetitorDiscoveryError";
}

export async function listServices(subjectId: string): Promise<SubjectService[]> {
	return db
		.select()
		.from(subjectServices)
		.where(eq(subjectServices.subjectId, subjectId))
		.orderBy(asc(subjectServices.createdAt), asc(subjectServices.name));
}

const MAX_SERVICE_LENGTH = 80;

export async function addService(subjectId: string, input: string): Promise<SubjectService> {
	const name = input.trim().replace(/\s+/g, " ");
	if (!name) throw new CompetitorDiscoveryError("Enter a service, such as plumber");
	if (name.length > MAX_SERVICE_LENGTH) {
		throw new CompetitorDiscoveryError(`Keep a service under ${MAX_SERVICE_LENGTH} characters`);
	}
	const [service] = await db.insert(subjectServices).values({ subjectId, name }).onConflictDoNothing().returning();
	if (!service) throw new CompetitorDiscoveryError(`"${name}" is already a service`);
	return service;
}

/** Its seed searches go with it; competitors it found stay until discovery next ranks them. */
export async function removeService(subjectId: string, serviceId: string): Promise<boolean> {
	const removed = await db
		.delete(subjectServices)
		.where(and(eq(subjectServices.subjectId, subjectId), eq(subjectServices.id, serviceId)))
		.returning({ id: subjectServices.id });
	return removed.length > 0;
}

export async function getDiscoverySettings(subjectId: string): Promise<DiscoverySettings> {
	const [row] = await db
		.select()
		.from(competitorDiscoverySettings)
		.where(eq(competitorDiscoverySettings.subjectId, subjectId));
	return row ? { minRuns: row.minRuns, perArea: row.perArea, windowDays: row.windowDays } : DEFAULT_DISCOVERY_SETTINGS;
}

const LIMITS: Record<keyof DiscoverySettings, [min: number, max: number, label: string]> = {
	minRuns: [1, 100, "Runs before a business is tracked"],
	perArea: [1, 50, "Competitors per area"],
	windowDays: [7, 365, "Days of runs counted"],
};

export async function saveDiscoverySettings(subjectId: string, input: DiscoverySettings): Promise<DiscoverySettings> {
	for (const [key, [min, max, label]] of Object.entries(LIMITS)) {
		const value = input[key as keyof DiscoverySettings];
		if (!Number.isInteger(value) || value < min || value > max) {
			throw new CompetitorDiscoveryError(`${label} must be a whole number from ${min} to ${max}`);
		}
	}
	const settings = { minRuns: input.minRuns, perArea: input.perArea, windowDays: input.windowDays };
	await db
		.insert(competitorDiscoverySettings)
		.values({ subjectId, ...settings })
		.onConflictDoUpdate({ target: competitorDiscoverySettings.subjectId, set: settings });
	return settings;
}

/** Pins a competitor in its area, ignores it there, or leaves it to discovery again (`auto`). */
export async function setCompetitorStatus(
	subjectId: string,
	input: { id: string; status: AreaCompetitor["status"]; by: string },
): Promise<AreaCompetitor> {
	const decided = input.status !== "auto";
	const [row] = await db
		.update(areaCompetitors)
		.set({
			status: input.status,
			statusBy: decided ? input.by : null,
			statusAt: decided ? new Date() : null,
			// Settled now rather than on the next discovery, so the page shows the decision; discovery fills in an `auto` one.
			...(decided && { tracked: input.status === "pinned" }),
		})
		.where(and(eq(areaCompetitors.subjectId, subjectId), eq(areaCompetitors.id, input.id)))
		.returning();
	if (!row) throw new CompetitorDiscoveryError("That competitor isn't in this subject's areas");
	return row;
}

export interface AreaCompetitors {
	area: { id: string; name: string; isPrimary: boolean };
	competitors: AreaCompetitor[];
}

/** Each area's competitors: tracked first, then the most named, then Google's order. */
export async function listAreaCompetitors(subjectId: string): Promise<AreaCompetitors[]> {
	const [areas, rows] = await Promise.all([
		db
			.select({ id: subjectServiceAreas.id, name: subjectServiceAreas.name, isPrimary: subjectServiceAreas.isPrimary })
			.from(subjectServiceAreas)
			.where(eq(subjectServiceAreas.subjectId, subjectId))
			.orderBy(desc(subjectServiceAreas.isPrimary), asc(subjectServiceAreas.createdAt)),
		db
			.select()
			.from(areaCompetitors)
			.where(eq(areaCompetitors.subjectId, subjectId))
			.orderBy(
				desc(areaCompetitors.tracked),
				desc(areaCompetitors.answerRuns),
				sql`${areaCompetitors.seedRank} ASC NULLS LAST`,
				asc(areaCompetitors.name),
			),
	]);
	return areas.map((area) => ({ area, competitors: rows.filter((row) => row.areaId === area.id) }));
}

/** Subjects with a service area, the only ones with competitors to discover. Run with agency access. */
export async function subjectsWithServiceAreas(): Promise<string[]> {
	const rows = await db.selectDistinct({ subjectId: subjectServiceAreas.subjectId }).from(subjectServiceAreas);
	return rows.map((row) => row.subjectId);
}
