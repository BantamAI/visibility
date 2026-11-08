import { db } from "@workspace/lib/db/db";
import { isUniqueViolation } from "@workspace/lib/db/unique-names";
import { and, asc, eq, ne } from "drizzle-orm";
import { type ServiceArea, subjectServiceAreas } from "../schema";
import { MAX_GRID_SIZE, MIN_GRID_SIZE, parseAreaPolygon } from "./geo";
import { listSamplePoints, regenerateSamplePoints } from "./sample-points";

export type ServiceAreaInput = {
	name: string;
	centerLat: number;
	centerLng: number;
	radiusMeters: number;
	timezone: string;
	polygon?: unknown;
	isPrimary?: boolean;
	country?: string;
	gridSize?: number;
};

export class ServiceAreaInputError extends Error {
	override name = "ServiceAreaInputError";
}

const MIN_RADIUS_M = 100;
const MAX_RADIUS_M = 200_000;

function isTimeZone(value: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

function ensure(condition: boolean, message: string): asserts condition {
	if (!condition) throw new ServiceAreaInputError(message);
}

function polygonFrom(input: unknown) {
	if (input == null) return null;
	try {
		return parseAreaPolygon(input);
	} catch (error) {
		throw new ServiceAreaInputError((error as Error).message);
	}
}

export function normalizeServiceAreaInput(input: ServiceAreaInput) {
	const name = input.name.trim();
	ensure(name.length > 0, "A service area needs a name");
	ensure(
		Number.isFinite(input.centerLat) && Math.abs(input.centerLat) <= 90,
		"The center latitude must be between -90 and 90",
	);
	ensure(
		Number.isFinite(input.centerLng) && Math.abs(input.centerLng) <= 180,
		"The center longitude must be between -180 and 180",
	);
	const radiusMeters = Math.round(input.radiusMeters);
	ensure(
		radiusMeters >= MIN_RADIUS_M && radiusMeters <= MAX_RADIUS_M,
		`The radius must be between ${MIN_RADIUS_M} m and ${MAX_RADIUS_M / 1000} km`,
	);
	const timezone = input.timezone.trim();
	ensure(isTimeZone(timezone), `${input.timezone} isn't a known time zone`);
	const gridSize = input.gridSize ?? MIN_GRID_SIZE;
	ensure(
		Number.isInteger(gridSize) && gridSize >= MIN_GRID_SIZE && gridSize <= MAX_GRID_SIZE,
		`The grid size must be from ${MIN_GRID_SIZE} to ${MAX_GRID_SIZE}`,
	);
	const country = (input.country ?? "US").trim().toUpperCase();
	ensure(/^[A-Z]{2}$/.test(country), "The country must be a two-letter code");
	const polygon = polygonFrom(input.polygon);
	return {
		name,
		centerLat: input.centerLat,
		centerLng: input.centerLng,
		radiusMeters,
		timezone,
		gridSize,
		country,
		polygon,
		isPrimary: input.isPrimary ?? false,
	};
}

/**
 * Creates or updates one of the subject's service areas and regenerates its sample
 * points. A subject keeps one primary area: its first, or whichever was last marked
 * primary. Runs in the caller's
 * tenant scope; hand entry for prospects and the facts sync for linked clients
 * both come through here.
 */
export async function saveServiceArea(
	subjectId: string,
	input: ServiceAreaInput,
	areaId?: string,
): Promise<ServiceArea> {
	const values = normalizeServiceAreaInput(input);
	const area = await db
		.transaction(async (tx) => {
			const others = await tx
				.select({ id: subjectServiceAreas.id, isPrimary: subjectServiceAreas.isPrimary })
				.from(subjectServiceAreas)
				.where(
					and(eq(subjectServiceAreas.subjectId, subjectId), areaId ? ne(subjectServiceAreas.id, areaId) : undefined),
				);
			const isPrimary = values.isPrimary || !others.some((other) => other.isPrimary);
			if (isPrimary && others.length > 0) {
				await tx
					.update(subjectServiceAreas)
					.set({ isPrimary: false })
					.where(and(eq(subjectServiceAreas.subjectId, subjectId), eq(subjectServiceAreas.isPrimary, true)));
			}
			const row = { ...values, isPrimary };
			const [saved] = areaId
				? await tx
						.update(subjectServiceAreas)
						.set(row)
						.where(and(eq(subjectServiceAreas.id, areaId), eq(subjectServiceAreas.subjectId, subjectId)))
						.returning()
				: await tx
						.insert(subjectServiceAreas)
						.values({ ...row, subjectId })
						.returning();
			if (!saved) throw new ServiceAreaInputError("That service area doesn't exist");
			return saved;
		})
		.catch((error: unknown) => {
			if (isUniqueViolation(error, "subject_service_areas_subject_id_name_idx")) {
				throw new ServiceAreaInputError(`There's already a service area called ${values.name}`);
			}
			throw error;
		});
	await regenerateSamplePoints(area);
	return area;
}

/** Deletes the area and its points; if it was the primary one, the oldest remaining area takes over. */
export async function deleteServiceArea(subjectId: string, areaId: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [deleted] = await tx
			.delete(subjectServiceAreas)
			.where(and(eq(subjectServiceAreas.id, areaId), eq(subjectServiceAreas.subjectId, subjectId)))
			.returning({ isPrimary: subjectServiceAreas.isPrimary });
		if (!deleted) return false;
		if (deleted.isPrimary) {
			const [next] = await tx
				.select({ id: subjectServiceAreas.id })
				.from(subjectServiceAreas)
				.where(eq(subjectServiceAreas.subjectId, subjectId))
				.orderBy(asc(subjectServiceAreas.createdAt))
				.limit(1);
			if (next)
				await tx.update(subjectServiceAreas).set({ isPrimary: true }).where(eq(subjectServiceAreas.id, next.id));
		}
		return true;
	});
}

export async function listServiceAreas(subjectId: string) {
	const areas = await db
		.select()
		.from(subjectServiceAreas)
		.where(eq(subjectServiceAreas.subjectId, subjectId))
		.orderBy(asc(subjectServiceAreas.createdAt));
	const points = await listSamplePoints(areas.map((area) => area.id));
	return areas.map((area) => ({ ...area, samplePoints: points.filter((point) => point.areaId === area.id) }));
}
