import { db } from "@workspace/lib/db/db";
import { prompts, runMentions } from "@workspace/lib/db/schema";
import type { FidelityTier } from "@workspace/lib/providers";
import { and, asc, desc, eq, gte, inArray, isNull, lt, type SQL, sql } from "drizzle-orm";
import {
	type GridScan,
	gridScanRuns,
	gridScans,
	localMentions,
	runLocations,
	samplePoints,
	subjectServiceAreas,
	type UncoveredScanPoint,
} from "../schema";
import { type Proportion, wilsonInterval } from "./interval";
import { judgedBrand, subjectPosition } from "./judged";

/** Only these routes place an answer at the point itself, so only their scans can be read as a map. */
export const HEAT_MAP_TIERS: readonly FidelityTier[] = ["T1", "T2"];

export interface HeatMapScope {
	since: Date;
	until: Date;
	areaId?: string;
	model?: string;
	/** Intersected with `HEAT_MAP_TIERS`. */
	tiers?: readonly FidelityTier[];
	promptIds?: readonly string[];
}

export interface HeatMapScan {
	id: string;
	areaId: string;
	areaName: string | null;
	promptId: string;
	prompt: string;
	model: string;
	fidelityTier: FidelityTier;
	pointKind: GridScan["pointKind"];
	status: GridScan["status"];
	createdAt: Date;
}

const scanColumns = {
	id: gridScans.id,
	areaId: gridScans.areaId,
	areaName: subjectServiceAreas.name,
	promptId: gridScans.promptId,
	prompt: prompts.value,
	model: gridScans.model,
	fidelityTier: gridScans.fidelityTier,
	pointKind: gridScans.pointKind,
	status: gridScans.status,
	createdAt: gridScans.createdAt,
};

/** The latest T1/T2 scan of each prompt on each engine in scope, newest first. */
export async function listHeatMapScans(subjectId: string, scope: HeatMapScope): Promise<HeatMapScan[]> {
	const tiers = HEAT_MAP_TIERS.filter((tier) => !scope.tiers || scope.tiers.includes(tier));
	if (tiers.length === 0 || scope.promptIds?.length === 0) return [];
	const filters: SQL[] = [
		eq(gridScans.subjectId, subjectId),
		inArray(gridScans.fidelityTier, tiers),
		gte(gridScans.createdAt, scope.since),
		lt(gridScans.createdAt, scope.until),
	];
	if (scope.areaId) filters.push(eq(gridScans.areaId, scope.areaId));
	if (scope.model) filters.push(eq(gridScans.model, scope.model));
	if (scope.promptIds) filters.push(inArray(gridScans.promptId, [...scope.promptIds]));
	const rows = await db
		.selectDistinctOn([gridScans.areaId, gridScans.promptId, gridScans.model], scanColumns)
		.from(gridScans)
		.innerJoin(prompts, eq(prompts.id, gridScans.promptId))
		.leftJoin(subjectServiceAreas, eq(subjectServiceAreas.id, gridScans.areaId))
		.where(and(...filters))
		.orderBy(gridScans.areaId, gridScans.promptId, gridScans.model, desc(gridScans.createdAt));
	return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.prompt.localeCompare(b.prompt));
}

export interface HeatMapPoint {
	pointId: string;
	label: string | null;
	lat: number;
	lng: number;
	/** Answers at the point that name the subject, over those matched so far. */
	mentions: Proportion;
	/** Over the answers that rank the subject; null when none do. */
	averagePosition: number | null;
	/** Answers not yet back or not yet matched. */
	pending: number;
	failed: number;
	/** The route couldn't place this point: a stand-in's answers fill it, or with none it's a gap. */
	standIn: boolean;
	gap: boolean;
}

interface ScanRunRow {
	pointId: string;
	location: { latitude: number; longitude: number };
	status: "pending" | "answered" | "failed";
	label: string | null;
	matched: boolean;
	mentioned: boolean;
	cardPosition: number | null;
	textPosition: string | null;
}

interface PointTally {
	point: Omit<HeatMapPoint, "mentions" | "averagePosition">;
	matched: number;
	mentioned: number;
	positionSum: number;
	ranked: number;
}

const newTally = (run: ScanRunRow): PointTally => ({
	point: {
		pointId: run.pointId,
		label: run.label,
		lat: run.location.latitude,
		lng: run.location.longitude,
		pending: 0,
		failed: 0,
		standIn: false,
		gap: false,
	},
	matched: 0,
	mentioned: 0,
	positionSum: 0,
	ranked: 0,
});

function countRun(tally: PointTally, run: ScanRunRow) {
	if (run.status === "failed") tally.point.failed++;
	else if (run.status === "pending" || !run.matched) tally.point.pending++;
	else {
		tally.matched++;
		if (!run.mentioned) return;
		tally.mentioned++;
		const { position } = subjectPosition(run.cardPosition, run.textPosition);
		if (position === null) return;
		tally.positionSum += position;
		tally.ranked++;
	}
}

const finishTally = ({ point, matched, mentioned, positionSum, ranked }: PointTally): HeatMapPoint => ({
	...point,
	mentions: wilsonInterval(mentioned, matched),
	averagePosition: ranked === 0 ? null : positionSum / ranked,
});

function uncoveredPoint(u: UncoveredScanPoint, tallies: Map<string, PointTally>): HeatMapPoint {
	const standIn = u.standInPointId ? tallies.get(u.standInPointId) : undefined;
	const base = { pointId: u.pointId, label: u.label, lat: u.lat, lng: u.lng };
	if (standIn) return { ...finishTally(standIn), ...base, standIn: true };
	return {
		...base,
		mentions: wilsonInterval(0, 0),
		averagePosition: null,
		pending: 0,
		failed: 0,
		standIn: false,
		gap: true,
	};
}

/** Every point of a scan with how often its answers name the subject and where they rank it. */
export async function scanHeatMap(scanId: string): Promise<{ scan: HeatMapScan; points: HeatMapPoint[] } | null> {
	const [row] = await db
		.select({ scan: scanColumns, uncovered: gridScans.uncovered })
		.from(gridScans)
		.innerJoin(prompts, eq(prompts.id, gridScans.promptId))
		.leftJoin(subjectServiceAreas, eq(subjectServiceAreas.id, gridScans.areaId))
		.where(eq(gridScans.id, scanId));
	if (!row) return null;
	const { scan, uncovered: uncoveredPoints } = row;

	const runs = await db
		.select({
			pointId: gridScanRuns.pointId,
			location: gridScanRuns.location,
			status: gridScanRuns.status,
			label: samplePoints.label,
			matched: sql<boolean>`${runLocations.localMentionsStamp} IS NOT NULL`,
			mentioned: sql<boolean>`${localMentions.id} IS NOT NULL`,
			cardPosition: localMentions.cardPosition,
			textPosition: judgedBrand("position"),
		})
		.from(gridScanRuns)
		.leftJoin(samplePoints, eq(samplePoints.id, gridScanRuns.pointId))
		.leftJoin(runLocations, eq(runLocations.runId, gridScanRuns.runId))
		.leftJoin(
			localMentions,
			and(
				eq(localMentions.runId, gridScanRuns.runId),
				isNull(localMentions.competitorName),
				eq(localMentions.counted, true),
			),
		)
		.leftJoin(runMentions, eq(runMentions.runId, gridScanRuns.runId))
		.where(eq(gridScanRuns.scanId, scanId))
		.orderBy(asc(gridScanRuns.pointId), asc(gridScanRuns.repeat));

	const tallies = new Map<string, PointTally>();
	for (const run of runs) {
		const tally = tallies.get(run.pointId) ?? newTally(run);
		tallies.set(run.pointId, tally);
		countRun(tally, run);
	}
	const points = [...tallies.values()].map(finishTally);
	const uncovered = uncoveredPoints.map((u) => uncoveredPoint(u, tallies));
	return { scan, points: [...points, ...uncovered] };
}
