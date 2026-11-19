import { useQuery } from "@tanstack/react-query";
import { getModelMeta } from "@workspace/config/models";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useState } from "react";
import { TIER_LABELS } from "@/lib/fidelity-tiers";
import type { LookbackPeriod } from "@/lib/lookback";
import { getLocalHeatMapFn, getLocalHeatMapScansFn } from "@/server/local-metrics";
import { InfoTip, intervalText, pct, plural } from "./shared";

type Scans = Awaited<ReturnType<typeof getLocalHeatMapScansFn>>;
type HeatMap = NonNullable<Awaited<ReturnType<typeof getLocalHeatMapFn>>>;
type Point = HeatMap["points"][number];

export interface HeatMapFilters {
	areaId?: string;
	lookback: LookbackPeriod;
	tags?: string;
	model?: string;
	tiers?: ("T1" | "T2" | "T3" | "T4" | "T5")[];
}

const SIZE = 320;
const PAD = 28;
const RADIUS = 15;

/** Red at 0%, amber at 50%, green at 100%. */
function rateColor(rate: number): string {
	const stops = [
		[239, 68, 68],
		[245, 158, 11],
		[34, 197, 94],
	] as const;
	const scaled = Math.min(Math.max(rate, 0), 1) * 2;
	const i = Math.min(Math.floor(scaled), 1);
	const t = scaled - i;
	const [a, b] = [stops[i], stops[i + 1]] as [readonly number[], readonly number[]];
	return `rgb(${a.map((v, k) => Math.round(v + ((b[k] ?? v) - v) * t)).join(",")})`;
}

/** Plots each point where it is: longitude scaled by latitude so the grid keeps its shape. */
function project(points: Point[]) {
	const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / Math.max(points.length, 1);
	const kx = Math.cos((meanLat * Math.PI) / 180);
	const xs = points.map((p) => p.lng * kx);
	const ys = points.map((p) => p.lat);
	const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
	const span = Math.max(maxX - minX, maxY - minY) || 1;
	const scale = (SIZE - 2 * PAD) / span;
	const offsetX = (SIZE - (maxX - minX) * scale) / 2;
	const offsetY = (SIZE - (maxY - minY) * scale) / 2;
	return (p: Point) => ({ x: offsetX + (p.lng * kx - minX) * scale, y: SIZE - offsetY - (p.lat - minY) * scale });
}

function pointTitle(point: Point): string {
	const lines = [point.label ?? "Point"];
	if (point.gap) lines.push("The route couldn't place this point, and no city stands in for it.");
	else {
		if (point.standIn) lines.push("The route couldn't place this point; a nearby city's answers stand in.");
		lines.push(
			point.mentions.trials === 0
				? "No matched answers yet"
				: `Named in ${point.mentions.successes} of ${plural(point.mentions.trials, "answer")} (${pct(point.mentions.rate)}, 95% interval ${intervalText(point.mentions)})`,
		);
		if (point.averagePosition !== null) lines.push(`Average position ${point.averagePosition.toFixed(1)}`);
		if (point.pending > 0) lines.push(`${plural(point.pending, "answer")} still coming in`);
		if (point.failed > 0) lines.push(`${plural(point.failed, "answer")} failed`);
	}
	return lines.join("\n");
}

function pointStyle(point: Point) {
	const rate = point.mentions.rate;
	const empty = point.gap || rate === null;
	const dashed = point.standIn || point.gap;
	return {
		fill: empty ? "#f4f4f5" : rateColor(rate),
		stroke: empty ? "#a1a1aa" : "#ffffff",
		strokeWidth: dashed ? 1.5 : 2,
		strokeDasharray: dashed ? "3 2" : undefined,
		text: empty ? "#71717a" : "#ffffff",
	};
}

function pointText(point: Point): string {
	if (point.gap) return "×";
	return point.averagePosition === null ? "–" : String(Math.round(point.averagePosition));
}

function PointMark({ point, x, y }: { point: Point; x: number; y: number }) {
	const { text, ...circle } = pointStyle(point);
	return (
		<g>
			<title>{pointTitle(point)}</title>
			<circle cx={x} cy={y} r={RADIUS} {...circle} />
			<text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600} fill={text}>
				{pointText(point)}
			</text>
		</g>
	);
}

function HeatMapSvg({ points }: { points: Point[] }) {
	const at = project(points);
	return (
		<svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto w-full max-w-sm" role="img" aria-label="Grid heat map">
			<title>Grid heat map</title>
			{points.map((point) => (
				<PointMark key={point.pointId} point={point} {...at(point)} />
			))}
		</svg>
	);
}

function Legend() {
	return (
		<div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
			<span className="flex items-center gap-1.5">
				<span
					className="h-2 w-16 rounded-full"
					style={{ background: `linear-gradient(to right, ${rateColor(0)}, ${rateColor(0.5)}, ${rateColor(1)})` }}
				/>
				Named 0–100%
			</span>
			<span>Number: Average Position</span>
			<span>Dashed: Stand-In</span>
			<span>×: Not Covered</span>
		</div>
	);
}

const scanLabel = (scan: Scans[number]) =>
	`${scan.prompt} · ${getModelMeta(scan.model).label} · ${scan.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

/** One T1/T2 scan's points, colored by how often their answers name the subject. */
export function GridHeatMapCard({ brandId, filters }: { brandId: string; filters: HeatMapFilters }) {
	const [picked, setPicked] = useState<string>();
	const scans = useQuery({
		queryKey: ["local-heat-map-scans", brandId, filters],
		queryFn: () => getLocalHeatMapScansFn({ data: { brandId, ...filters } }),
		staleTime: 30_000,
	});
	const scanId = scans.data?.some((scan) => scan.id === picked) ? picked : scans.data?.[0]?.id;
	const heatMap = useQuery({
		queryKey: ["local-heat-map", brandId, scanId],
		queryFn: () => getLocalHeatMapFn({ data: { brandId, scanId: scanId as string } }),
		enabled: Boolean(scanId),
		staleTime: 30_000,
	});
	const selected = scans.data?.find((scan) => scan.id === scanId);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-1.5 text-sm font-medium">
					Grid Heat Map
					<InfoTip>
						Each circle is a sample point in the latest scan of a prompt on one engine. Its color is the share of the
						point's answers that name you, and its number is your average position there. Only exact-point (T1) and
						city-exit (T2) routes are mapped, since other routes don't answer from the point itself.
					</InfoTip>
				</CardTitle>
				{selected && (
					<CardDescription>
						{selected.areaName ?? "Removed area"} · {TIER_LABELS[selected.fidelityTier]}
						{selected.status === "running" && " · Still running"}
					</CardDescription>
				)}
				{scans.data && scans.data.length > 0 && (
					<CardAction>
						<Select
							items={Object.fromEntries(scans.data.map((scan) => [scan.id, scanLabel(scan)]))}
							value={scanId}
							onValueChange={(value) => setPicked(value as string)}
						>
							<SelectTrigger className="w-72 max-w-full" aria-label="Scan">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{scans.data.map((scan) => (
									<SelectItem key={scan.id} value={scan.id}>
										{scanLabel(scan)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</CardAction>
				)}
			</CardHeader>
			<CardContent className="space-y-3">
				{scans.isLoading || (scanId && heatMap.isLoading) ? (
					<Skeleton className="mx-auto aspect-square w-full max-w-sm" />
				) : !scanId ? (
					<p className="text-sm text-muted-foreground">
						No exact-point or city-exit scans in this period. Heat maps need a grid scan on a T1 or T2 route.
					</p>
				) : heatMap.data ? (
					<>
						<HeatMapSvg points={heatMap.data.points} />
						<Legend />
					</>
				) : (
					<p className="text-sm text-muted-foreground">Couldn't load this scan.</p>
				)}
			</CardContent>
		</Card>
	);
}
