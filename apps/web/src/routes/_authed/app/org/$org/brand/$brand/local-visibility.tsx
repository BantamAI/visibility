import { IconLayersSubtract, IconMapPin } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getModelMeta } from "@workspace/config/models";
import { ModelIcon } from "@workspace/ui/brand/model-icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useState } from "react";
import { ALL_MODELS_VALUE, FilterBar, FilterTriggerButton } from "@/components/filter-bar";
import { GridHeatMapCard } from "@/components/local-metrics/heat-map";
import { RateTable } from "@/components/local-metrics/rate-table";
import { InfoTip, IntervalBar, intervalText, PHRASING_LABELS, pct, plural } from "@/components/local-metrics/shared";
import { MentionTrendChart } from "@/components/local-metrics/trend-chart";
import { FilterSection, PageHeader } from "@/components/page-header";
import { useBrandId } from "@/hooks/use-brand-id";
import { useBrand } from "@/hooks/use-brands";
import { useListFilters } from "@/hooks/use-list-filters";
import { useBrandParams } from "@/hooks/use-route-params";
import { TIER_LABELS } from "@/lib/fidelity-tiers";
import { pageHead } from "@/lib/route-head";
import { getLocalMetricsFn } from "@/server/local-metrics";

export const Route = createFileRoute("/_authed/app/org/$org/brand/$brand/local-visibility")({
	staticData: { crumb: "Local Visibility" },
	head: pageHead({
		description: "See how often AI answers in your service areas name you, with confidence intervals.",
	}),
	component: LocalVisibilityPage,
});

type Tier = "T1" | "T2" | "T3" | "T4" | "T5";
const TIERS: Tier[] = ["T1", "T2", "T3", "T4", "T5"];
const ALL_AREAS = "all";

type Result = Awaited<ReturnType<typeof getLocalMetricsFn>>;
type Metrics = NonNullable<Result["metrics"]>;

function AreaDropdown({
	areas,
	value,
	onChange,
}: {
	areas: { id: string; name: string }[];
	value: string | undefined;
	onChange: (areaId: string | undefined) => void;
}) {
	if (areas.length < 2) return null;
	const name = areas.find((area) => area.id === value)?.name ?? "All Areas";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<FilterTriggerButton icon={<IconMapPin className="size-3.5" />} label={name} active={Boolean(value)} />}
			/>
			<DropdownMenuContent align="start" className="w-56">
				<DropdownMenuRadioGroup
					value={value ?? ALL_AREAS}
					onValueChange={(next) => onChange(next === ALL_AREAS ? undefined : (next as string))}
				>
					<DropdownMenuRadioItem value={ALL_AREAS} className="cursor-pointer">
						All Areas
					</DropdownMenuRadioItem>
					{areas.map((area) => (
						<DropdownMenuRadioItem key={area.id} value={area.id} className="cursor-pointer">
							{area.name}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function TierDropdown({
	value,
	onChange,
}: {
	value: Tier[] | undefined;
	onChange: (tiers: Tier[] | undefined) => void;
}) {
	const selected = value ?? TIERS;
	const toggle = (tier: Tier) => {
		const next = selected.includes(tier) ? selected.filter((t) => t !== tier) : [...selected, tier];
		onChange(next.length === TIERS.length ? undefined : TIERS.filter((t) => next.includes(t)));
	};
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<FilterTriggerButton
						icon={<IconLayersSubtract className="size-3.5" />}
						label={value ? `Tiers ${value.join(", ") || "None"}` : "All Tiers"}
						active={Boolean(value)}
					/>
				}
			/>
			<DropdownMenuContent align="start" className="w-60">
				{TIERS.map((tier) => (
					<DropdownMenuCheckboxItem
						key={tier}
						checked={selected.includes(tier)}
						onCheckedChange={() => toggle(tier)}
						closeOnClick={false}
						className="cursor-pointer"
					>
						{TIER_LABELS[tier]}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function MentionRateCard({ metrics }: { metrics: Metrics }) {
	const rate = metrics.mentionRate;
	const tiers = TIERS.filter((tier) => metrics.tiers[tier] > 0);
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-1.5 text-sm font-medium">
					Mention Rate
					<InfoTip>
						The share of answers in your service areas that name you. The range is a Wilson 95% interval: with this many
						answers, the true rate is likely inside it. More answers narrow it.
					</InfoTip>
				</CardTitle>
				<CardDescription>
					{rate.trials === 0 ? "No answers in this period" : `Of ${plural(rate.trials, "answer")}`}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex items-baseline gap-3">
					<span className="text-3xl font-semibold tabular-nums">{pct(rate.rate)}</span>
					{rate.trials > 0 && (
						<span className="text-sm text-muted-foreground tabular-nums">95% interval {intervalText(rate)}</span>
					)}
				</div>
				<IntervalBar interval={rate} />
				{tiers.length > 0 && (
					<p className="text-xs text-muted-foreground">
						{tiers.map((tier) => `${TIER_LABELS[tier]}: ${metrics.tiers[tier]}`).join(" · ")}
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function ShareOfVoiceCard({ metrics }: { metrics: Metrics }) {
	const sov = metrics.shareOfVoice;
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-1.5 text-sm font-medium">
					Share of Voice
					<InfoTip>
						Your mentions over yours plus your tracked competitors&apos;, counting one per answer. Only competitors
						tracked in an answer&apos;s own area count.
					</InfoTip>
				</CardTitle>
				<CardDescription>{plural(sov.totalMentions, "mention")} in all</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<span className="text-3xl font-semibold tabular-nums">{pct(sov.share)}</span>
				{sov.competitors.length > 0 && (
					<ul className="space-y-1 text-sm">
						{sov.competitors.slice(0, 5).map((competitor) => (
							<li key={competitor.name} className="flex justify-between gap-2">
								<span className="truncate">{competitor.name}</span>
								<span className="tabular-nums text-muted-foreground">{pct(competitor.share)}</span>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

function PositionCard({ metrics }: { metrics: Metrics }) {
	const { average, ranked, byCard } = metrics.position;
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-1.5 text-sm font-medium">
					Average Position
					<InfoTip>
						Where answers that name you place you. A business card&apos;s position counts when a card is matched to you;
						otherwise it&apos;s your rank among the tracked businesses the answer names. Lower is better.
					</InfoTip>
				</CardTitle>
				<CardDescription>
					{ranked === 0 ? "No answer ranks you" : `Over ${plural(ranked, "answer")}, ${byCard} by card`}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<span className="text-3xl font-semibold tabular-nums">{average === null ? "–" : average.toFixed(1)}</span>
			</CardContent>
		</Card>
	);
}

const SENTIMENTS = [
	{ key: "positive", label: "Positive", color: "bg-green-500" },
	{ key: "neutral", label: "Neutral", color: "bg-zinc-400" },
	{ key: "mixed", label: "Mixed", color: "bg-amber-500" },
	{ key: "negative", label: "Negative", color: "bg-red-500" },
] as const;

function SentimentCard({ metrics }: { metrics: Metrics }) {
	const { judged, counts, positive } = metrics.sentiment;
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-1.5 text-sm font-medium">
					Sentiment
					<InfoTip>
						How answers that name you describe you, as the mention judge reads them. Answers that show you only as a
						card have no sentiment.
					</InfoTip>
				</CardTitle>
				<CardDescription>
					{judged === 0
						? "No answer judged yet"
						: `${pct(positive.rate)} positive (95% interval ${intervalText(positive)})`}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{judged > 0 && (
					<div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
						{SENTIMENTS.map(({ key, color }) => (
							<div key={key} className={color} style={{ width: `${(counts[key] / judged) * 100}%` }} />
						))}
					</div>
				)}
				<ul className="grid grid-cols-2 gap-1 text-sm">
					{SENTIMENTS.map(({ key, label, color }) => (
						<li key={key} className="flex items-center gap-1.5">
							<span className={`size-2 rounded-full ${color}`} />
							{label}
							<span className="ml-auto tabular-nums text-muted-foreground">{counts[key]}</span>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}

function EngineLabel({ model }: { model: string }) {
	const { label, iconId } = getModelMeta(model);
	return (
		<span className="flex items-center gap-1.5">
			<ModelIcon iconId={iconId} className="size-3.5" />
			{label}
		</span>
	);
}

function MetricsBody({ result }: { result: Result & { metrics: Metrics } }) {
	const { metrics, areas } = result;
	const areaName = (id: string) => areas.find((area) => area.id === id)?.name ?? "Removed Area";
	return (
		<div className="space-y-6">
			<div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
				<MentionRateCard metrics={metrics} />
				<ShareOfVoiceCard metrics={metrics} />
				<PositionCard metrics={metrics} />
				<SentimentCard metrics={metrics} />
			</div>
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-1.5 text-sm font-medium">
						Mention Rate by Week
						<InfoTip>
							The shaded band is each week&apos;s 95% interval. A dashed line marks a week whose mix of location tiers
							moved by 20 points or more from the week before, so its rate isn&apos;t measured the same way.
						</InfoTip>
					</CardTitle>
				</CardHeader>
				<CardContent>
					<MentionTrendChart weeks={metrics.trend} />
				</CardContent>
			</Card>
			<div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
				<RateTable
					title="By Engine"
					dimension="Engine"
					rows={metrics.byEngine}
					label={(model) => <EngineLabel model={model} />}
				/>
				<RateTable title="By Area" dimension="Area" rows={metrics.byArea} label={areaName} />
				<RateTable
					title="By Phrasing"
					dimension="Phrasing"
					rows={metrics.byPhrasing}
					label={(key) => PHRASING_LABELS[key] ?? key}
				/>
			</div>
		</div>
	);
}

function LocalVisibilityPage() {
	const brandId = useBrandId();
	const brandParams = useBrandParams();
	const { model, lookback, tags } = useListFilters();
	const { data: brand } = useBrand(brandId);
	const [areaId, setAreaId] = useState<string>();
	const [tiers, setTiers] = useState<Tier[]>();

	const filters = {
		areaId,
		lookback,
		tags: tags.length > 0 ? tags.join(",") : undefined,
		model: model === ALL_MODELS_VALUE ? undefined : model,
		tiers,
	};
	const { data, isLoading, error } = useQuery({
		queryKey: ["local-metrics", brandId, filters],
		queryFn: () => getLocalMetricsFn({ data: { brandId, ...filters } }),
		staleTime: 30_000,
		placeholderData: keepPreviousData,
	});

	const infoContent = (
		<>
			<p className="mb-2">
				Each figure comes from located answers: prompts run from sample points in your service areas, with businesses
				matched by Place ID, phone, website or the mention judge.
			</p>
			<p>
				The metrics are kept apart on purpose. A blended score would hide which one moved and how sure the figure is.
			</p>
		</>
	);

	return (
		<PageHeader
			title="Local Visibility"
			subtitle="How often AI answers in your service areas name you, and how sure each figure is."
			infoContent={infoContent}
		>
			<FilterSection>
				<FilterBar
					availableTags={data?.availableTags ?? []}
					trackedTargets={brand?.trackedTargets ?? []}
					showSearch={false}
					showModelSelector
					extraControls={
						<>
							<AreaDropdown areas={data?.areas ?? []} value={areaId} onChange={setAreaId} />
							<TierDropdown value={tiers} onChange={setTiers} />
						</>
					}
				/>
			</FilterSection>
			{isLoading && !data ? (
				<div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
					{[0, 1, 2, 3].map((i) => (
						<Skeleton key={i} className="h-36 w-full" />
					))}
				</div>
			) : error || !data ? (
				<Card>
					<CardContent className="pt-6">
						<div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
							Failed to load local metrics. Please try again.
						</div>
					</CardContent>
				</Card>
			) : !data.metrics ? (
				<Card>
					<CardContent className="py-8 text-center text-sm text-muted-foreground">
						Local metrics need a service area. Add one on the{" "}
						<Link to="/app/org/$org/brand/$brand/settings/service-areas" params={brandParams} className="underline">
							Service Areas
						</Link>{" "}
						page.
					</CardContent>
				</Card>
			) : (
				<div className="space-y-6">
					<MetricsBody result={{ ...data, metrics: data.metrics }} />
					<GridHeatMapCard brandId={brandId} filters={filters} />
				</div>
			)}
		</PageHeader>
	);
}
