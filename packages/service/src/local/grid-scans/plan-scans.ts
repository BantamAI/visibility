import type { FidelityTier, ModelConfig } from "@workspace/lib/providers";
import type { PlannerPoint, RunPlan } from "../run-planner";
import type { SamplePointKind, UncoveredScanPoint } from "../schema";

/** One scan a schedule makes: a prompt on a route across every point of one kind in an area. */
export interface ScanSpec {
	areaId: string;
	promptId: string;
	config: ModelConfig;
	tier: FidelityTier;
	pointKind: SamplePointKind;
	repeats: number;
	intervalDays: number;
	points: PlannerPoint[];
	uncovered: UncoveredScanPoint[];
	estimatedCostUsd: number | null;
}

export type ScanIdentity = {
	areaId: string;
	promptId: string;
	model: string;
	provider: string;
	pointKind: SamplePointKind;
};

/** Scans with the same key are one series. A new route for the engine is a new key, so it starts its own. */
export function scanKey(scan: ScanIdentity): string {
	return [scan.areaId, scan.promptId, scan.model, scan.provider, scan.pointKind].join("|");
}

export function specKey(spec: ScanSpec): string {
	return scanKey({ ...spec, model: spec.config.model, provider: spec.config.provider });
}

function groupByArea(points: readonly PlannerPoint[]): Map<string, PlannerPoint[]> {
	const byArea = new Map<string, PlannerPoint[]>();
	for (const point of points) {
		const list = byArea.get(point.areaId) ?? [];
		list.push(point);
		byArea.set(point.areaId, list);
	}
	return byArea;
}

/** Splits each planned series into one scan per area and prompt. */
export function scansFor(plan: RunPlan, points: readonly PlannerPoint[]): ScanSpec[] {
	const byId = new Map(points.map((point) => [point.id, point]));
	const specs: ScanSpec[] = [];
	for (const series of plan.series) {
		const served = series.pointIds.flatMap((id) => byId.get(id) ?? []);
		const uncovered = plan.uncovered.flatMap((u) => {
			const point = byId.get(u.pointId);
			return u.engine === series.engine && point?.kind === series.pointKind ? [{ u, point }] : [];
		});
		for (const [areaId, areaPoints] of groupByArea(served)) {
			const areaUncovered = uncovered
				.filter(({ point }) => point.areaId === areaId)
				.map(({ u, point }) => ({
					pointId: point.id,
					label: point.label,
					lat: point.lat,
					lng: point.lng,
					reason: u.reason,
					standInPointId: u.standIn?.pointId ?? null,
				}));
			for (const promptId of series.promptIds) {
				const scoped = series.scopedPrompts?.[promptId];
				const scanPoints = scoped ? areaPoints.filter((point) => scoped.pointIds.includes(point.id)) : areaPoints;
				if (scanPoints.length === 0) continue;
				const scanUncovered = scoped
					? areaUncovered.filter((u) => scoped.uncoveredPointIds.includes(u.pointId))
					: areaUncovered;
				const estimatedCostUsd =
					series.costPerRunUsd === null ? null : series.costPerRunUsd * scanPoints.length * series.repeats;
				specs.push({
					areaId,
					promptId,
					config: series.config,
					tier: series.tier,
					pointKind: series.pointKind,
					repeats: series.repeats,
					intervalDays: series.intervalDays,
					points: scanPoints,
					uncovered: scanUncovered,
					estimatedCostUsd,
				});
			}
		}
	}
	return specs;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lets a scan start up to this much early, so a weekly scan doesn't slip later by one
 * scheduler tick every week.
 */
export const EARLY_START_MS = 60 * 60 * 1000;

/** The scans whose series has never run, or last started at least its interval ago. */
export function dueScans(specs: readonly ScanSpec[], lastStartedAt: ReadonlyMap<string, Date>, now: Date): ScanSpec[] {
	return specs.filter((spec) => {
		const last = lastStartedAt.get(specKey(spec));
		return !last || now.getTime() - last.getTime() >= spec.intervalDays * DAY_MS - EARLY_START_MS;
	});
}
