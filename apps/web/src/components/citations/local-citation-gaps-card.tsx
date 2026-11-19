import { IconInfoCircle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getModelMeta } from "@workspace/config/models";
import { ModelIcon } from "@workspace/ui/brand/model-icon";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { useState } from "react";
import { formatUrlForDisplay, getCategoryColorClass, getCategoryLabel } from "@/components/citations/shared";
import { ListPagination, usePagedList } from "@/components/list-pagination";
import { SiteIcon } from "@/components/site-icon";
import { useBrandParams } from "@/hooks/use-route-params";
import type { LookbackPeriod } from "@/lib/lookback";
import { getLocalCitationGapsFn } from "@/server/local-citation-gaps";

const PAGE_SIZE = 8;

type Gaps = Awaited<ReturnType<typeof getLocalCitationGapsFn>>;
type Gap = NonNullable<Gaps["result"]>["gaps"][number];

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;

function Engines({ engines }: { engines: string[] }) {
	return (
		<div className="flex items-center gap-1">
			{engines.map((model) => {
				const { label, iconId } = getModelMeta(model);
				return (
					<Tooltip key={model}>
						<TooltipTrigger render={<span role="img" className="text-muted-foreground" aria-label={label} />}>
							<ModelIcon iconId={iconId} className="size-3.5" />
						</TooltipTrigger>
						<TooltipContent>{label}</TooltipContent>
					</Tooltip>
				);
			})}
		</div>
	);
}

function GapRow({ gap }: { gap: Gap }) {
	return (
		<div className="flex items-start gap-2.5 py-2.5">
			<SiteIcon domain={gap.domain} size="sm" className="mt-0.5 shrink-0" />
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex flex-wrap items-center gap-1.5">
					<a
						href={`https://${gap.domain}`}
						target="_blank"
						rel="noopener noreferrer"
						className="text-sm font-medium hover:underline"
					>
						{gap.domain}
					</a>
					<span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getCategoryColorClass(gap.category)}`}>
						{getCategoryLabel(gap.category)}
					</span>
					<Engines engines={gap.engines} />
				</div>
				<p className="text-xs text-muted-foreground">
					Cited in {plural(gap.runs, "answer")} naming{" "}
					{gap.competitors.map((competitor, i) => (
						<span key={competitor.name}>
							{i > 0 && ", "}
							<span className="text-foreground">{competitor.name}</span> ({competitor.runs})
						</span>
					))}
				</p>
				<ul className="space-y-0.5">
					{gap.pages.map((page) => (
						<li key={page.url} className="truncate text-xs">
							<a
								href={page.url}
								target="_blank"
								rel="noopener noreferrer"
								className="text-muted-foreground hover:text-foreground hover:underline"
								title={page.title ?? page.url}
							>
								{formatUrlForDisplay(page.url)}
							</a>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}

function GapList({ gaps }: { gaps: Gap[] }) {
	const { page, setPage, pageItems, totalItems } = usePagedList(gaps, PAGE_SIZE);
	return (
		<>
			<div className="divide-y divide-border/50">
				{pageItems.map((gap) => (
					<GapRow key={gap.domain} gap={gap} />
				))}
			</div>
			<ListPagination page={page} pageSize={PAGE_SIZE} totalItems={totalItems} onPageChange={setPage} />
		</>
	);
}

function GapsBody({ data }: { data: Gaps }) {
	const brandParams = useBrandParams();
	const result = data.result;
	if (!result) return null;
	if (result.trackedCompetitors === 0)
		return (
			<p className="text-sm text-muted-foreground">
				No competitors are tracked in this area yet. Find them on the{" "}
				<Link to="/app/org/$org/brand/$brand/settings/local-competitors" params={brandParams} className="underline">
					Local Competitors
				</Link>{" "}
				page.
			</p>
		);
	if (result.gaps.length === 0)
		return (
			<p className="text-sm text-muted-foreground">
				{result.runs === 0
					? "No answers in this area name you or a tracked competitor in this period."
					: "Every source cited for your competitors here is cited for you too."}
			</p>
		);
	return <GapList gaps={result.gaps} />;
}

/** Sources an area's answers cite for its tracked competitors but never for the subject. Hidden for a subject with no service area. */
export function LocalCitationGapsCard({
	brandId,
	filters,
}: {
	brandId: string;
	filters: { lookback: LookbackPeriod; tags?: string[]; model?: string };
}) {
	const [areaId, setAreaId] = useState<string>();
	const tags = filters.tags?.join(",");
	const { data, isLoading } = useQuery({
		queryKey: ["local-citation-gaps", brandId, areaId, filters.lookback, tags, filters.model],
		queryFn: () =>
			getLocalCitationGapsFn({ data: { brandId, areaId, lookback: filters.lookback, tags, model: filters.model } }),
		staleTime: 30_000,
		placeholderData: (prev) => prev,
	});

	if (isLoading && !data)
		return (
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-48" />
				</CardHeader>
			</Card>
		);
	if (!data?.areaId) return null;

	const areaName = data.areas.find((area) => area.id === data.areaId)?.name;
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-1.5">
					Local Citation Gaps
					<Tooltip>
						<TooltipTrigger render={<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />} />
						<TooltipContent className="max-w-xs text-sm font-normal">
							Sources that answers in this area cite when they name a tracked competitor, but never when they name you.
							Ranked by answers × engines × competitors. Competitors&apos; own sites are left out.
						</TooltipContent>
					</Tooltip>
				</CardTitle>
				<CardDescription>Sources cited for your competitors in {areaName}, but never for you</CardDescription>
				{data.areas.length > 1 && (
					<CardAction>
						<Select
							items={Object.fromEntries(data.areas.map((area) => [area.id, area.name]))}
							value={data.areaId}
							onValueChange={(value) => setAreaId(value as string)}
						>
							<SelectTrigger className="w-44" aria-label="Service Area">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{data.areas.map((area) => (
									<SelectItem key={area.id} value={area.id}>
										{area.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</CardAction>
				)}
			</CardHeader>
			<Separator />
			<CardContent>
				<GapsBody data={data} />
			</CardContent>
		</Card>
	);
}
