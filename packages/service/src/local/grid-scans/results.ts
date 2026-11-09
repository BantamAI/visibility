import { db } from "@workspace/lib/db/db";
import { citations, prompts, runExtractions } from "@workspace/lib/db/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { type GridScan, gridScanRuns, gridScans, samplePoints, subjectServiceAreas } from "../schema";

export interface ScanSummary {
	id: string;
	areaName: string | null;
	prompt: string;
	model: string;
	provider: string;
	fidelityTier: GridScan["fidelityTier"];
	pointKind: GridScan["pointKind"];
	status: GridScan["status"];
	pointsPlanned: number;
	pointsAnswered: number;
	/** Points answered ÷ points planned. */
	coverage: number;
	estimatedCostUsd: number | null;
	/** Of the runs answered so far; final once the scan completes. */
	costUsd: number | null;
	createdAt: Date;
	completedAt: Date | null;
}

/** The subject's latest scans, newest first. */
export async function listScans(subjectId: string, limit = 50): Promise<ScanSummary[]> {
	const answered = db
		.select({
			scanId: gridScanRuns.scanId,
			points: sql<number>`count(DISTINCT ${gridScanRuns.pointId})::int`.as("points"),
		})
		.from(gridScanRuns)
		.where(and(eq(gridScanRuns.subjectId, subjectId), eq(gridScanRuns.status, "answered")))
		.groupBy(gridScanRuns.scanId)
		.as("answered");
	const rows = await db
		.select({
			scan: gridScans,
			areaName: subjectServiceAreas.name,
			prompt: prompts.value,
			livePointsAnswered: answered.points,
			liveCostUsd: sql<string | null>`(SELECT sum(l.cost_usd) FROM grid_scan_runs r JOIN run_locations l ON l.run_id = r.run_id WHERE r.scan_id = ${gridScans.id})`,
		})
		.from(gridScans)
		.innerJoin(prompts, eq(prompts.id, gridScans.promptId))
		.leftJoin(subjectServiceAreas, eq(subjectServiceAreas.id, gridScans.areaId))
		.leftJoin(answered, eq(answered.scanId, gridScans.id))
		.where(eq(gridScans.subjectId, subjectId))
		.orderBy(desc(gridScans.createdAt))
		.limit(limit);
	return rows.map(({ scan, areaName, prompt, livePointsAnswered, liveCostUsd }) => {
		const pointsAnswered = scan.pointsAnswered ?? livePointsAnswered ?? 0;
		return {
			id: scan.id,
			areaName,
			prompt,
			model: scan.model,
			provider: scan.provider,
			fidelityTier: scan.fidelityTier,
			pointKind: scan.pointKind,
			status: scan.status,
			pointsPlanned: scan.pointsPlanned,
			pointsAnswered,
			coverage: pointsAnswered / scan.pointsPlanned,
			estimatedCostUsd: scan.estimatedCostUsd,
			costUsd: scan.status === "complete" ? scan.costUsd : liveCostUsd === null ? null : Number(liveCostUsd),
			createdAt: scan.createdAt,
			completedAt: scan.completedAt,
		};
	});
}

export interface ScanRunResult {
	repeat: number;
	status: "pending" | "answered" | "failed";
	runId: string | null;
	answer: string | null;
	citations: { url: string; domain: string; title: string | null }[];
	error: string | null;
}

export interface ScanPointResult {
	pointId: string;
	label: string | null;
	lat: number;
	lng: number;
	/**
	 * Set when the route couldn't place this point and a nearby city stands in for it:
	 * `runs` are then the stand-in's. A point the route couldn't place with no stand-in
	 * is a gap, with no runs.
	 */
	standInPointId: string | null;
	uncoveredReason: string | null;
	runs: ScanRunResult[];
}

async function loadRuns(scanId: string) {
	const runs = await db
		.select({
			pointId: gridScanRuns.pointId,
			location: gridScanRuns.location,
			repeat: gridScanRuns.repeat,
			status: gridScanRuns.status,
			runId: gridScanRuns.runId,
			error: gridScanRuns.lastError,
			answer: runExtractions.textContent,
			label: samplePoints.label,
		})
		.from(gridScanRuns)
		.leftJoin(runExtractions, eq(runExtractions.runId, gridScanRuns.runId))
		.leftJoin(samplePoints, eq(samplePoints.id, gridScanRuns.pointId))
		.where(eq(gridScanRuns.scanId, scanId))
		.orderBy(asc(gridScanRuns.pointId), asc(gridScanRuns.repeat));
	const runIds = runs.flatMap((run) => (run.runId ? [run.runId] : []));
	const cited =
		runIds.length === 0
			? []
			: await db
					.select({
						runId: citations.promptRunId,
						url: citations.url,
						domain: citations.domain,
						title: citations.title,
					})
					.from(citations)
					.where(inArray(citations.promptRunId, runIds))
					.orderBy(asc(citations.citationIndex));
	return { runs, cited };
}

/**
 * Every point of a scan with its answers and cited sources, for heat maps. Answers
 * and citations appear once the run has been judged, shortly after it's saved.
 */
export async function getScanResults(scanId: string): Promise<{ scan: GridScan; points: ScanPointResult[] } | null> {
	const [scan] = await db.select().from(gridScans).where(eq(gridScans.id, scanId));
	if (!scan) return null;
	const { runs, cited } = await loadRuns(scanId);

	const citationsByRun = new Map<string, ScanRunResult["citations"]>();
	for (const { runId, ...citation } of cited) {
		citationsByRun.set(runId, [...(citationsByRun.get(runId) ?? []), citation]);
	}
	const points = new Map<string, ScanPointResult>();
	for (const run of runs) {
		const point = points.get(run.pointId) ?? {
			pointId: run.pointId,
			label: run.label,
			lat: run.location.latitude,
			lng: run.location.longitude,
			standInPointId: null,
			uncoveredReason: null,
			runs: [],
		};
		point.runs.push({
			repeat: run.repeat,
			status: run.status,
			runId: run.runId,
			answer: run.answer,
			citations: (run.runId && citationsByRun.get(run.runId)) || [],
			error: run.error,
		});
		points.set(run.pointId, point);
	}
	const uncovered = scan.uncovered.map((u) => ({
		pointId: u.pointId,
		label: u.label,
		lat: u.lat,
		lng: u.lng,
		standInPointId: u.standInPointId,
		uncoveredReason: u.reason,
		runs: u.standInPointId ? (points.get(u.standInPointId)?.runs ?? []) : [],
	}));
	return { scan, points: [...points.values(), ...uncovered] };
}
