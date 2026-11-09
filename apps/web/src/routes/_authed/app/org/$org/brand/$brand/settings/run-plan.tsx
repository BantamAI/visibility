import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MAX_INTERVAL_DAYS, MAX_REPEATS, NEAR_ME_TAG } from "@workspace/service/local/run-planner/constants";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Switch } from "@workspace/ui/components/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { useEffect, useState } from "react";
import { useBrandId } from "@/hooks/use-brand-id";
import { pageHead } from "@/lib/route-head";
import { useWriteErrorMessage } from "@/lib/write-errors";
import { getRecentScans, getRunPlan, previewRunPlanFn, saveRunScheduleFn } from "@/server/run-plan";

export const Route = createFileRoute("/_authed/app/org/$org/brand/$brand/settings/run-plan")({
	staticData: { crumb: "Run Plan" },
	head: pageHead({ description: "Plan located runs and keep them within a monthly budget." }),
	component: RunPlanSettingsPage,
});

type Draft = {
	enabled: boolean;
	monthlyBudgetUsd: string;
	scanIntervalDays: string;
	centroidIntervalDays: string;
	repeats: string;
};

type Settings = {
	enabled: boolean;
	monthlyBudgetUsd: number | null;
	scanIntervalDays: number;
	centroidIntervalDays: number;
	repeats: number;
};

const TIER_LABELS: Record<string, string> = {
	T1: "T1 · Exact Point",
	T2: "T2 · City Exit",
	T3: "T3 · State Exit",
	T4: "T4 · API Approximation",
	T5: "T5 · City in Prompt",
};

const POINT_KINDS: Record<string, string> = { centroid: "cities", grid: "grid", zip: "ZIPs" };

const usd = (value: number) => `$${value.toFixed(2)}`;
const cents = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;

function scanCost(range: { min: number; max: number } | null): string {
	if (!range) return "Unknown";
	return range.min === range.max ? cents(range.min) : `${cents(range.min)}–${cents(range.max)}`;
}
const whole = (value: number) => Math.round(value).toLocaleString();

function draftFrom(settings: Settings): Draft {
	return {
		enabled: settings.enabled,
		monthlyBudgetUsd: settings.monthlyBudgetUsd === null ? "" : String(settings.monthlyBudgetUsd),
		scanIntervalDays: String(settings.scanIntervalDays),
		centroidIntervalDays: String(settings.centroidIntervalDays),
		repeats: String(settings.repeats),
	};
}

/** Null while a field isn't a valid number yet, so the preview waits instead of erroring. */
function settingsFrom(draft: Draft): Settings | null {
	const budget = draft.monthlyBudgetUsd.trim() === "" ? null : Number(draft.monthlyBudgetUsd);
	const settings = {
		enabled: draft.enabled,
		monthlyBudgetUsd: budget,
		scanIntervalDays: Number(draft.scanIntervalDays),
		centroidIntervalDays: Number(draft.centroidIntervalDays),
		repeats: Number(draft.repeats),
	};
	const inRange = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max;
	if (budget !== null && !(Number.isFinite(budget) && budget >= 0)) return null;
	if (!inRange(settings.scanIntervalDays, MAX_INTERVAL_DAYS)) return null;
	if (!inRange(settings.centroidIntervalDays, MAX_INTERVAL_DAYS)) return null;
	if (!inRange(settings.repeats, MAX_REPEATS)) return null;
	return settings;
}

function RunPlanSettingsPage() {
	const brandId = useBrandId();
	const queryClient = useQueryClient();
	const writeError = useWriteErrorMessage();
	const { data: saved, isLoading } = useQuery({
		queryKey: ["run-plan", brandId],
		queryFn: () => getRunPlan({ data: { brandId } }),
		enabled: !!brandId,
	});
	const [draft, setDraft] = useState<Draft | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (saved && !draft) setDraft(draftFrom(saved.schedule));
	}, [saved, draft]);

	const settings = draft ? settingsFrom(draft) : null;
	const { data: preview } = useQuery({
		queryKey: ["run-plan-preview", brandId, settings],
		queryFn: () => previewRunPlanFn({ data: { brandId, settings: settings as Settings } }),
		enabled: !!brandId && settings !== null,
		placeholderData: keepPreviousData,
	});

	if (isLoading || !draft) return <p className="text-muted-foreground">Loading...</p>;

	const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
	const shown = preview ?? saved;

	const save = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!settings) {
			setError("Check the fields: each needs a whole number in range.");
			return;
		}
		setError(null);
		setSaving(true);
		try {
			await saveRunScheduleFn({ data: { brandId, settings } });
			await queryClient.invalidateQueries({ queryKey: ["run-plan", brandId] });
		} catch (err) {
			setError(writeError(err, "Failed to save the run plan."));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="max-w-5xl space-y-6">
			<div>
				<h1 className="text-3xl font-bold">Run Plan</h1>
				<p className="text-muted-foreground">
					Located runs for this subject: every engine, sample point and prompt, priced before anything runs. Prompts
					tagged <code>{NEAR_ME_TAG}</code> run on the grid; the rest name a city and run on city centroids.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Schedule</CardTitle>
					<CardDescription>
						Full scans cover every point. City centroids on the two cheapest exact-point routes can run more often, such as daily.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="plan-budget">Monthly Budget (USD)</Label>
							<Input
								id="plan-budget"
								inputMode="decimal"
								placeholder="No budget set"
								value={draft.monthlyBudgetUsd}
								onChange={(e) => set("monthlyBudgetUsd", e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="plan-repeats">Repeats per Run</Label>
							<Input
								id="plan-repeats"
								type="number"
								min={1}
								max={MAX_REPEATS}
								value={draft.repeats}
								onChange={(e) => set("repeats", e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="plan-scan">Days Between Full Scans</Label>
							<Input
								id="plan-scan"
								type="number"
								min={1}
								max={MAX_INTERVAL_DAYS}
								value={draft.scanIntervalDays}
								onChange={(e) => set("scanIntervalDays", e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="plan-centroid">Days Between City Runs</Label>
							<Input
								id="plan-centroid"
								type="number"
								min={1}
								max={MAX_INTERVAL_DAYS}
								value={draft.centroidIntervalDays}
								onChange={(e) => set("centroidIntervalDays", e.target.value)}
							/>
						</div>
						<div className="flex items-center gap-2 sm:col-span-2">
							<Switch
								id="plan-enabled"
								checked={draft.enabled}
								onCheckedChange={(checked) => set("enabled", checked)}
							/>
							<Label htmlFor="plan-enabled">Schedule Enabled</Label>
						</div>
						{error && <p className="text-destructive text-sm sm:col-span-2">{error}</p>}
						<div className="sm:col-span-2">
							<Button type="submit" disabled={saving}>
								{saving ? "Saving..." : "Save"}
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>

			{shown && (
				<Card>
					<CardHeader>
						<CardTitle>Planned Runs</CardTitle>
						<CardDescription>
							About {whole(shown.plan.runsPerMonth)} runs and {usd(shown.plan.costPerMonthUsd)} a month.{" "}
							{shown.refusal && draft.enabled ? (
								<span className="text-destructive">{shown.refusal}</span>
							) : (
								settings?.monthlyBudgetUsd != null && `Within the ${usd(settings.monthlyBudgetUsd)} budget.`
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{shown.plan.series.length === 0 ? (
							<p className="text-muted-foreground">
								Nothing to run yet. Add service areas, enabled prompts and LLMs for this subject.
							</p>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Engine</TableHead>
										<TableHead>Route</TableHead>
										<TableHead>Fidelity</TableHead>
										<TableHead>Points</TableHead>
										<TableHead className="text-right">Prompts</TableHead>
										<TableHead className="text-right">Every</TableHead>
										<TableHead className="text-right">Cost a Scan</TableHead>
										<TableHead className="text-right">Runs a Month</TableHead>
										<TableHead className="text-right">Cost a Month</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{shown.plan.series.map((series) => (
										<SeriesRow key={series.key} series={series} />
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			)}

			{shown && <PausedEnginesCard paused={shown.plan.paused} />}
			{shown && <UncoveredPointsCard uncovered={shown.plan.uncovered} />}
			<RecentScansCard brandId={brandId} />
		</div>
	);
}

type Plan = Awaited<ReturnType<typeof getRunPlan>>["plan"];
type Series = Plan["series"][number];

function PausedEnginesCard({ paused }: { paused: Plan["paused"] }) {
	if (paused.length === 0) return null;
	return (
		<Card>
			<CardHeader>
				<CardTitle>Paused Engines</CardTitle>
				<CardDescription>
					Canaries marked these routes degraded. Their engines make no located runs until the route recovers or you
					configure a different one, which starts a new series.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ul className="list-disc space-y-1 pl-5">
					{paused.map((p) => (
						<li key={p.key}>
							{p.engine} through {p.provider} ({TIER_LABELS[p.tier] ?? p.tier})
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}

function UncoveredPointsCard({ uncovered }: { uncovered: Plan["uncovered"] }) {
	if (uncovered.length === 0) return null;
	return (
		<Card>
			<CardHeader>
				<CardTitle>Points the Route Can't Place</CardTitle>
				<CardDescription>
					Each takes the results of the nearest city in its area that the same route can place, so it adds no runs.
					Points with no such city are gaps.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Engine</TableHead>
							<TableHead>Point</TableHead>
							<TableHead>Covered By</TableHead>
							<TableHead>Why</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{uncovered.map((u) => (
							<TableRow key={u.key}>
								<TableCell>{u.engine}</TableCell>
								<TableCell>{u.point}</TableCell>
								<TableCell>{u.standIn ?? <span className="text-muted-foreground">Gap</span>}</TableCell>
								<TableCell className="text-muted-foreground">{u.reason}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}

function SeriesRow({ series }: { series: Series }) {
	return (
		<TableRow>
			<TableCell>{series.engine}</TableCell>
			<TableCell>{series.provider}</TableCell>
			<TableCell>
				<Badge variant={series.tier === "T1" ? "default" : "secondary"}>
					{TIER_LABELS[series.tier] ?? series.tier}
				</Badge>
			</TableCell>
			<TableCell>
				{series.points} {POINT_KINDS[series.pointKind]}
			</TableCell>
			<TableCell className="text-right">{series.prompts}</TableCell>
			<TableCell className="text-right">{series.intervalDays === 1 ? "day" : `${series.intervalDays} days`}</TableCell>
			<TableCell className="text-right">{scanCost(series.costPerScanUsd)}</TableCell>
			<TableCell className="text-right">{whole(series.runsPerMonth)}</TableCell>
			<TableCell className="text-right">
				{series.costPerMonthUsd === null ? "Unknown" : usd(series.costPerMonthUsd)}
			</TableCell>
		</TableRow>
	);
}

type Scan = Awaited<ReturnType<typeof getRecentScans>>[number];

function RecentScansCard({ brandId }: { brandId: string }) {
	const { data: scans } = useQuery({
		queryKey: ["run-plan-scans", brandId],
		queryFn: () => getRecentScans({ data: { brandId } }),
		enabled: !!brandId,
		refetchInterval: 30_000,
	});
	if (!scans || scans.length === 0) return null;
	return (
		<Card>
			<CardHeader>
				<CardTitle>Recent Scans</CardTitle>
				<CardDescription>
					Each scan runs one prompt on one route across every point of one kind in an area. Coverage is the share of
					points that answered; points that still failed after retries are gaps.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Started</TableHead>
							<TableHead>Prompt</TableHead>
							<TableHead>Engine</TableHead>
							<TableHead>Area</TableHead>
							<TableHead className="text-right">Coverage</TableHead>
							<TableHead className="text-right">Estimate</TableHead>
							<TableHead className="text-right">Cost</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{scans.map((scan) => (
							<ScanRow key={scan.id} scan={scan} />
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}

function ScanRow({ scan }: { scan: Scan }) {
	return (
		<TableRow>
			<TableCell className="whitespace-nowrap">{new Date(scan.createdAt).toLocaleString()}</TableCell>
			<TableCell className="max-w-64 truncate" title={scan.prompt}>
				{scan.prompt}
			</TableCell>
			<TableCell>
				{scan.engine} <span className="text-muted-foreground">via {scan.provider}</span>
			</TableCell>
			<TableCell>
				{scan.areaName ?? "Removed area"} <span className="text-muted-foreground">({POINT_KINDS[scan.pointKind]})</span>
			</TableCell>
			<TableCell className="text-right">
				{scan.pointsAnswered}/{scan.pointsPlanned}
				{scan.status === "running" ? (
					<Badge variant="secondary" className="ml-2">
						Running
					</Badge>
				) : (
					<span className="text-muted-foreground"> ({Math.round(scan.coverage * 100)}%)</span>
				)}
			</TableCell>
			<TableCell className="text-right">
				{scan.estimatedCostUsd === null ? "Unknown" : cents(scan.estimatedCostUsd)}
			</TableCell>
			<TableCell className="text-right">{scan.costUsd === null ? "—" : cents(scan.costUsd)}</TableCell>
		</TableRow>
	);
}
