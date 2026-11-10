import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Label } from "@workspace/ui/components/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { TagsInput } from "@workspace/ui/components/tags-input";
import { useEffect, useState } from "react";
import { useBrandId } from "@/hooks/use-brand-id";
import { useBrandParams } from "@/hooks/use-route-params";
import { pageHead } from "@/lib/route-head";
import { useWriteErrorMessage } from "@/lib/write-errors";
import { addLocalPromptsFn, getLocalPrompts, previewLocalPromptsFn, setServiceJobsFn } from "@/server/local-prompts";

export const Route = createFileRoute("/_authed/app/org/$org/brand/$brand/settings/local-prompts")({
	staticData: { crumb: "Local Prompts" },
	head: pageHead({ description: "Prompts generated from each service, its jobs and the cities it serves." }),
	component: LocalPromptsPage,
});

type LocalPrompts = Awaited<ReturnType<typeof getLocalPrompts>>;
type Preview = Awaited<ReturnType<typeof previewLocalPromptsFn>>;

const mainCities = (areas: LocalPrompts["areas"]) =>
	areas.flatMap(({ cities }) => cities.filter((city) => city.main).map((city) => city.tag));

const usd = (value: number) => `$${value.toFixed(2)}`;

function LocalPromptsPage() {
	const brandId = useBrandId();
	const brandParams = useBrandParams();
	const queryClient = useQueryClient();
	const writeError = useWriteErrorMessage();
	const { data, isLoading } = useQuery({
		queryKey: ["local-prompts", brandId],
		queryFn: () => getLocalPrompts({ data: { brandId } }),
		enabled: !!brandId,
	});
	const [cityTags, setCityTags] = useState<string[] | null>(null);
	const picked = cityTags ?? (data ? mainCities(data.areas) : []);
	const previewKey = ["local-prompts-preview", brandId, [...picked].sort()];
	const preview = useQuery({
		queryKey: previewKey,
		queryFn: () => previewLocalPromptsFn({ data: { brandId, cityTags: picked } }),
		enabled: !!data,
		placeholderData: keepPreviousData,
	});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const act = async (action: () => Promise<unknown>, failure: string) => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await action();
			await queryClient.invalidateQueries({ queryKey: ["local-prompts", brandId] });
			await queryClient.invalidateQueries({ queryKey: ["local-prompts-preview", brandId] });
		} catch (err) {
			setError(writeError(err, failure));
		} finally {
			setBusy(false);
		}
	};

	const toggle = (tag: string, on: boolean) =>
		setCityTags(on ? [...new Set([...picked, tag])] : picked.filter((known) => known !== tag));

	const add = () =>
		act(async () => {
			const { added } = await addLocalPromptsFn({ data: { brandId, cityTags: picked } });
			setNotice(`Added ${added} prompt${added === 1 ? "" : "s"}.`);
		}, "Couldn't add the prompts.");

	return (
		<div className="max-w-5xl space-y-6">
			<div>
				<h1 className="text-3xl font-bold">Local Prompts</h1>
				<p className="text-muted-foreground">
					Every service is asked the same four ways (emergency, cost, best and reviews), plus once for each of its jobs.
					Each prompt is asked "near me", which runs across every area's grid, and again naming each city you pick,
					which runs only at that city. Two branded prompts check the business's license and hours.
				</p>
			</div>
			{error && <p className="text-destructive text-sm">{error}</p>}
			{notice && <p className="text-sm">{notice}</p>}

			{isLoading || !data ? (
				<p className="text-muted-foreground">Loading...</p>
			) : data.services.length === 0 ? (
				<p className="text-muted-foreground">
					Add a service on the{" "}
					<Link to="/app/org/$org/brand/$brand/settings/local-competitors" params={brandParams} className="underline">
						Local Competitors
					</Link>{" "}
					page first: prompts are generated per service.
				</p>
			) : (
				<>
					<JobsCard
						services={data.services}
						maxJobs={data.maxJobs}
						busy={busy}
						onSave={(serviceId, jobs) =>
							act(() => setServiceJobsFn({ data: { brandId, serviceId, jobs } }), "Couldn't save the jobs.")
						}
					/>
					<CitiesCard
						areas={data.areas}
						picked={picked}
						onToggle={toggle}
						onMainOnly={() => setCityTags(mainCities(data.areas))}
					/>
					{preview.data && <PreviewCard preview={preview.data} busy={busy} onAdd={add} />}
				</>
			)}
		</div>
	);
}

function JobsCard({
	services,
	maxJobs,
	busy,
	onSave,
}: {
	services: LocalPrompts["services"];
	maxJobs: number;
	busy: boolean;
	onSave: (serviceId: string, jobs: string[]) => Promise<void>;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Services and Jobs</CardTitle>
				<CardDescription>
					A job is a specific task people ask for under a service, such as "water heater replacement". Up to {maxJobs}{" "}
					per service.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{services.map((service) => (
					<ServiceJobs key={service.id} service={service} maxJobs={maxJobs} busy={busy} onSave={onSave} />
				))}
			</CardContent>
		</Card>
	);
}

function ServiceJobs({
	service,
	maxJobs,
	busy,
	onSave,
}: {
	service: LocalPrompts["services"][number];
	maxJobs: number;
	busy: boolean;
	onSave: (serviceId: string, jobs: string[]) => Promise<void>;
}) {
	const [jobs, setJobs] = useState(service.jobs);
	useEffect(() => setJobs(service.jobs), [service.jobs]);
	const changed = jobs.join("\n") !== service.jobs.join("\n");
	return (
		<div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-center">
			<Label className="font-medium">{service.name}</Label>
			<TagsInput
				value={jobs}
				onValueChange={setJobs}
				allowCustomValues
				maxItems={maxJobs}
				pasteSplitter={/[\n,]+/}
				placeholder="Add a job"
				disabled={busy}
			/>
			<Button variant="outline" disabled={busy || !changed} onClick={() => onSave(service.id, jobs)}>
				Save Jobs
			</Button>
		</div>
	);
}

function CitiesCard({
	areas,
	picked,
	onToggle,
	onMainOnly,
}: {
	areas: LocalPrompts["areas"];
	picked: string[];
	onToggle: (tag: string, on: boolean) => void;
	onMainOnly: () => void;
}) {
	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between gap-4">
					<div className="space-y-1.5">
						<CardTitle>Cities</CardTitle>
						<CardDescription>
							Each city you pick gets its own city-named copy of every service and job prompt. Each area's main city,
							the one nearest its center, is picked to start with.
						</CardDescription>
					</div>
					<Button variant="outline" size="sm" onClick={onMainOnly}>
						Main Cities Only
					</Button>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{areas.length === 0 && (
					<p className="text-muted-foreground text-sm">
						Add a service area to name cities. Without one, only "near me" prompts are made.
					</p>
				)}
				{areas.map(({ area, cities }) => (
					<div key={area.id} className="space-y-2">
						<div className="font-medium">{area.name}</div>
						{cities.length === 0 ? (
							<p className="text-muted-foreground text-sm">No cities in this area yet.</p>
						) : (
							<div className="flex flex-wrap gap-x-6 gap-y-2">
								{cities.map((city) => (
									<div key={city.tag} className="flex items-center gap-2">
										<Checkbox
											id={`${area.id}-${city.tag}`}
											checked={picked.includes(city.tag)}
											onCheckedChange={(checked) => onToggle(city.tag, checked === true)}
										/>
										<Label htmlFor={`${area.id}-${city.tag}`} className="font-normal">
											{city.region ? `${city.city}, ${city.region}` : city.city}
										</Label>
										{city.main && <Badge variant="secondary">Main</Badge>}
									</div>
								))}
							</div>
						)}
					</div>
				))}
			</CardContent>
		</Card>
	);
}

function PreviewCard({ preview, busy, onAdd }: { preview: Preview; busy: boolean; onAdd: () => void }) {
	const total = preview.existingCount + preview.adding.length;
	const { before, after } = preview.costPerMonthUsd;
	const budget = preview.schedule.monthlyBudgetUsd;
	return (
		<Card>
			<CardHeader>
				<CardTitle>Prompts</CardTitle>
				<CardDescription>
					{preview.adding.length} new, {preview.prompts.length - preview.adding.length} already added. The brand would
					have {total} of {preview.maxPrompts} prompts. The run plan would cost about {usd(after)} a month (now{" "}
					{usd(before)}){budget === null ? ", with no budget set" : `, against a ${usd(budget)} budget`}
					{preview.schedule.enabled ? "." : ". The schedule is off, so nothing runs until it's enabled."}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{preview.unpriced && (
					<p className="text-muted-foreground text-sm">
						Some routes have no cost estimate, so the monthly cost leaves them out.
					</p>
				)}
				{preview.refusal && (
					<Alert variant="destructive">
						<AlertTitle>Can't Add These</AlertTitle>
						<AlertDescription>{preview.refusal}</AlertDescription>
					</Alert>
				)}
				<Button disabled={busy || preview.adding.length === 0 || preview.refusal !== null} onClick={onAdd}>
					Add {preview.adding.length} Prompt{preview.adding.length === 1 ? "" : "s"}
				</Button>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Prompt</TableHead>
							<TableHead>Tags</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{preview.prompts.map((prompt) => (
							<TableRow key={prompt.value}>
								<TableCell>{prompt.value}</TableCell>
								<TableCell className="text-muted-foreground text-xs">{prompt.tags.join(" · ")}</TableCell>
								<TableCell className="text-right">{prompt.exists && <Badge variant="outline">Added</Badge>}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
