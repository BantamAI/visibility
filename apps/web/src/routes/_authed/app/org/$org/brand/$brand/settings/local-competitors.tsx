import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { useState } from "react";
import { useBrandId } from "@/hooks/use-brand-id";
import { pageHead } from "@/lib/route-head";
import { useWriteErrorMessage } from "@/lib/write-errors";
import {
	addServiceFn,
	findCompetitorsFn,
	getCompetitorDiscovery,
	removeServiceFn,
	saveDiscoverySettingsFn,
	setCompetitorStatusFn,
} from "@/server/competitor-discovery";

export const Route = createFileRoute("/_authed/app/org/$org/brand/$brand/settings/local-competitors")({
	staticData: { crumb: "Local Competitors" },
	head: pageHead({ description: "Competitors found per service area, from Google and from AI answers." }),
	component: LocalCompetitorsPage,
});

type Discovery = Awaited<ReturnType<typeof getCompetitorDiscovery>>;
type Competitor = Discovery["areas"][number]["competitors"][number];
type Status = Competitor["status"];

const SERVICE_TAG_PREFIX = "service:";

function LocalCompetitorsPage() {
	const brandId = useBrandId();
	const queryClient = useQueryClient();
	const queryKey = ["competitor-discovery", brandId];
	const { data, isLoading } = useQuery({
		queryKey,
		queryFn: () => getCompetitorDiscovery({ data: { brandId } }),
		enabled: !!brandId,
	});
	const writeError = useWriteErrorMessage();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const act = async (action: () => Promise<unknown>, failure: string) => {
		setBusy(true);
		setError(null);
		try {
			await action();
			await queryClient.invalidateQueries({ queryKey });
		} catch (err) {
			setError(writeError(err, failure));
		} finally {
			setBusy(false);
		}
	};

	const setStatus = (competitor: Competitor, status: Status) =>
		act(() => setCompetitorStatusFn({ data: { brandId, id: competitor.id, status } }), "Couldn't change the competitor.");

	return (
		<div className="max-w-5xl space-y-6">
			<div>
				<h1 className="text-3xl font-bold">Local Competitors</h1>
				<p className="text-muted-foreground">
					Each service area tracks its own competitors: the businesses Google lists for each service there, and those AI
					answers in the area keep naming. Tracked ones are added to Competitors, so answers are checked for them. Pin a
					business to always track it in an area, or ignore it to never track it there.
				</p>
			</div>

			{data && !data.configured && (
				<Alert>
					<AlertTitle>Google Places Isn't Set Up</AlertTitle>
					<AlertDescription>
						Set GOOGLE_PLACES_API_KEY to seed competitors from Google. Businesses named in answers are still found.
					</AlertDescription>
				</Alert>
			)}
			{error && <p className="text-destructive text-sm">{error}</p>}

			{isLoading || !data ? (
				<p className="text-muted-foreground">Loading...</p>
			) : (
				<>
					<ServicesCard
						services={data.services}
						busy={busy}
						onAdd={(name) => act(() => addServiceFn({ data: { brandId, name } }), "Couldn't add the service.")}
						onRemove={(serviceId) =>
							act(() => removeServiceFn({ data: { brandId, serviceId } }), "Couldn't remove the service.")
						}
					/>
					<SettingsCard
						key={JSON.stringify(data.settings)}
						settings={data.settings}
						busy={busy}
						onSave={(settings) =>
							act(() => saveDiscoverySettingsFn({ data: { brandId, ...settings } }), "Couldn't save the settings.")
						}
					/>

					<div className="flex items-center justify-between gap-4">
						<p className="text-muted-foreground text-sm">
							Discovery runs every 15 minutes. Each new service or area is searched on Google once, for about $0.035.
						</p>
						<Button
							variant="outline"
							disabled={busy}
							onClick={() => act(() => findCompetitorsFn({ data: { brandId } }), "Couldn't find competitors.")}
						>
							Find Competitors Now
						</Button>
					</div>

					{data.areas.length === 0 ? (
						<p className="text-muted-foreground">Add a service area first: competitors are found per area.</p>
					) : (
						data.areas.map(({ area, competitors }) => (
							<AreaTable key={area.id} name={area.name} competitors={competitors} busy={busy} onStatus={setStatus} />
						))
					)}
				</>
			)}
		</div>
	);
}

function ServicesCard({
	services,
	busy,
	onAdd,
	onRemove,
}: {
	services: Discovery["services"];
	busy: boolean;
	onAdd: (name: string) => Promise<void>;
	onRemove: (serviceId: string) => Promise<void>;
}) {
	const [name, setName] = useState("");
	const add = async (event: React.FormEvent) => {
		event.preventDefault();
		await onAdd(name);
		setName("");
	};
	return (
		<Card>
			<CardHeader>
				<CardTitle>Services</CardTitle>
				<CardDescription>
					What this business sells, as people search for it. Each is searched on Google in every area. Tag a prompt{" "}
					<code>{SERVICE_TAG_PREFIX}&lt;service&gt;</code> to count its answers toward that service.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{services.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{services.map((service) => (
							<Badge key={service.id} variant="secondary" className="gap-1">
								{service.name}
								<button
									type="button"
									className="ml-1 text-muted-foreground hover:text-foreground"
									aria-label={`Remove ${service.name}`}
									disabled={busy}
									onClick={() => onRemove(service.id)}
								>
									×
								</button>
							</Badge>
						))}
					</div>
				)}
				<form onSubmit={add} className="flex gap-2">
					<Input
						className="max-w-sm"
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="plumber"
						aria-label="Service"
					/>
					<Button type="submit" disabled={busy || !name.trim()}>
						Add Service
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}

function SettingsCard({
	settings,
	busy,
	onSave,
}: {
	settings: Discovery["settings"];
	busy: boolean;
	onSave: (settings: Discovery["settings"]) => Promise<void>;
}) {
	const [draft, setDraft] = useState({
		minRuns: String(settings.minRuns),
		perArea: String(settings.perArea),
		windowDays: String(settings.windowDays),
	});
	const set = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
	const save = (event: React.FormEvent) => {
		event.preventDefault();
		onSave({ minRuns: Number(draft.minRuns), perArea: Number(draft.perArea), windowDays: Number(draft.windowDays) });
	};
	return (
		<Card>
			<CardHeader>
				<CardTitle>Discovery</CardTitle>
				<CardDescription>
					A business named in enough runs of one service in an area is tracked there. Each area tracks its pinned
					businesses plus its most-named ones, up to the limit, filling spare places with Google's listings.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={save} className="grid gap-4 sm:grid-cols-3">
					<div className="space-y-2">
						<Label htmlFor="discovery-min-runs">Runs Before Tracking</Label>
						<Input
							id="discovery-min-runs"
							type="number"
							min={1}
							max={100}
							value={draft.minRuns}
							onChange={(e) => set("minRuns", e.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="discovery-per-area">Competitors per Area</Label>
						<Input
							id="discovery-per-area"
							type="number"
							min={1}
							max={50}
							value={draft.perArea}
							onChange={(e) => set("perArea", e.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="discovery-window">Days of Runs Counted</Label>
						<Input
							id="discovery-window"
							type="number"
							min={7}
							max={365}
							value={draft.windowDays}
							onChange={(e) => set("windowDays", e.target.value)}
						/>
					</div>
					<div className="sm:col-span-3">
						<Button type="submit" disabled={busy}>
							Save
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

function foundBy(competitor: Competitor): string {
	const parts = [];
	if (competitor.answerRuns > 0) parts.push(`Named in ${competitor.answerRuns} run${competitor.answerRuns === 1 ? "" : "s"}`);
	if (competitor.seedRank !== null) parts.push(`Google #${competitor.seedRank}`);
	return parts.join(" · ") || "—";
}

function TrackedBadge({ competitor }: { competitor: Competitor }) {
	if (competitor.status === "ignored") return <Badge variant="outline">Ignored</Badge>;
	if (competitor.status === "pinned") return <Badge>Pinned</Badge>;
	return competitor.tracked ? <Badge variant="secondary">Tracked</Badge> : <Badge variant="outline">Not Tracked</Badge>;
}

function AreaTable({
	name,
	competitors,
	busy,
	onStatus,
}: {
	name: string;
	competitors: Competitor[];
	busy: boolean;
	onStatus: (competitor: Competitor, status: Status) => Promise<void>;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{name}</CardTitle>
				<CardDescription>
					{competitors.filter((competitor) => competitor.tracked).length} tracked of {competitors.length} found
				</CardDescription>
			</CardHeader>
			<CardContent>
				{competitors.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						None found yet. Add a service to search Google, or wait for answers from this area.
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Business</TableHead>
								<TableHead>Found By</TableHead>
								<TableHead>Services</TableHead>
								<TableHead>Status</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{competitors.map((competitor) => (
								<TableRow key={competitor.id}>
									<TableCell>
										<div className="font-medium">{competitor.name}</div>
										{competitor.website && (
											<div className="text-muted-foreground text-xs">{competitor.website.replace(/^https?:\/\//, "")}</div>
										)}
										{competitor.aliases.length > 0 && (
											<div className="text-muted-foreground text-xs">Also {competitor.aliases.join(", ")}</div>
										)}
									</TableCell>
									<TableCell className="text-sm">{foundBy(competitor)}</TableCell>
									<TableCell className="text-sm">{competitor.services.join(", ") || "—"}</TableCell>
									<TableCell>
										<TrackedBadge competitor={competitor} />
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-2">
											{competitor.status === "auto" ? (
												<>
													<Button variant="outline" size="sm" disabled={busy} onClick={() => onStatus(competitor, "pinned")}>
														Pin
													</Button>
													<Button variant="outline" size="sm" disabled={busy} onClick={() => onStatus(competitor, "ignored")}>
														Ignore
													</Button>
												</>
											) : (
												<Button variant="outline" size="sm" disabled={busy} onClick={() => onStatus(competitor, "auto")}>
													{competitor.status === "pinned" ? "Unpin" : "Stop Ignoring"}
												</Button>
											)}
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
