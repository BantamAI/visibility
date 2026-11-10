import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { useState } from "react";
import { useBrandId } from "@/hooks/use-brand-id";
import { pageHead } from "@/lib/route-head";
import { useWriteErrorMessage } from "@/lib/write-errors";
import {
	confirmPlaceAnchorFn,
	getPlaceAnchors,
	removePlaceAnchorFn,
	saveBusinessContactFn,
	searchPlacesFn,
} from "@/server/places";

export const Route = createFileRoute("/_authed/app/org/$org/brand/$brand/settings/place-ids")({
	staticData: { crumb: "Place IDs" },
	head: pageHead({
		description: "Anchor this business and its competitors on Google Place IDs, phones and addresses.",
	}),
	component: PlaceIdsSettingsPage,
});

type Anchors = Awaited<ReturnType<typeof getPlaceAnchors>>;
type Target = Anchors["targets"][number];
type Search = Awaited<ReturnType<typeof searchPlacesFn>>;

const METERS_PER_MILE = 1609.344;

const mapsLink = (name: string, placeId: string) =>
	`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(placeId)}`;

const day = (iso: string) => new Date(iso).toLocaleDateString();

function PlaceIdsSettingsPage() {
	const brandId = useBrandId();
	const queryClient = useQueryClient();
	const queryKey = ["place-anchors", brandId];
	const { data, isLoading } = useQuery({
		queryKey,
		queryFn: () => getPlaceAnchors({ data: { brandId } }),
		enabled: !!brandId,
	});
	const writeError = useWriteErrorMessage();
	const [finding, setFinding] = useState<Target | null>(null);
	const [editing, setEditing] = useState<Target | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = () => queryClient.invalidateQueries({ queryKey });

	const remove = async (target: Target) => {
		if (!window.confirm(`Remove the Place ID anchoring ${target.name}?`)) return;
		setError(null);
		try {
			await removePlaceAnchorFn({ data: { brandId, competitorName: target.competitorName } });
			await refresh();
		} catch (err) {
			setError(writeError(err, "Couldn't remove the Place ID."));
		}
	};

	return (
		<div className="max-w-4xl space-y-6">
			<div>
				<h1 className="text-3xl font-bold">Place IDs</h1>
				<p className="text-muted-foreground">
					Anchor this business and each tracked competitor on its Google Place ID, phone and address, so a same-named
					business in another city isn't counted as one of them. Answer cards are matched on all three, and the mention
					judge is told the phone and address.
				</p>
			</div>

			{data && !data.configured && (
				<Alert>
					<AlertTitle>Google Places Isn't Set Up</AlertTitle>
					<AlertDescription>
						Set GOOGLE_PLACES_API_KEY to search Google for businesses. Existing anchors still apply.
					</AlertDescription>
				</Alert>
			)}
			{error && <p className="text-destructive text-sm">{error}</p>}

			{isLoading || !data ? (
				<p className="text-muted-foreground">Loading...</p>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Business</TableHead>
							<TableHead>Place ID</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Phone and Address</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.targets.map((target) => (
							<TableRow key={target.competitorName ?? "subject"}>
								<TableCell>
									<div className="font-medium">{target.name}</div>
									<div className="text-muted-foreground text-xs">
										{target.competitorName === null ? "This business" : "Competitor"}
									</div>
								</TableCell>
								<TableCell className="font-mono text-xs">
									{target.anchor ? (
										<a
											className="underline"
											href={mapsLink(target.name, target.anchor.placeId)}
											target="_blank"
											rel="noreferrer"
										>
											{target.anchor.placeId}
										</a>
									) : (
										"—"
									)}
									{target.anchor?.cid && <div className="text-muted-foreground">CID {target.anchor.cid}</div>}
								</TableCell>
								<TableCell>
									<AnchorStatus target={target} />
								</TableCell>
								<TableCell className="text-sm">
									{target.phone || target.address ? (
										<>
											{target.phone && <div>{target.phone}</div>}
											{target.address && <div className="text-muted-foreground text-xs">{target.address}</div>}
										</>
									) : (
										"—"
									)}
								</TableCell>
								<TableCell className="text-right">
									<div className="flex justify-end gap-2">
										<Button variant="outline" size="sm" disabled={!data.configured} onClick={() => setFinding(target)}>
											{target.anchor ? "Change" : "Find"}
										</Button>
										{target.anchor && (
											<Button variant="outline" size="sm" onClick={() => remove(target)}>
												Remove
											</Button>
										)}
										<Button variant="outline" size="sm" onClick={() => setEditing(target)}>
											Edit Contact
										</Button>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}

			{editing && (
				<ContactEditor
					key={editing.competitorName ?? "subject"}
					brandId={brandId}
					target={editing}
					onDone={async (saved) => {
						if (saved) await refresh();
						setEditing(null);
					}}
				/>
			)}

			{finding && data && (
				<PlaceFinder
					key={finding.competitorName ?? "subject"}
					brandId={brandId}
					target={finding}
					areas={data.areas}
					onDone={async (confirmed) => {
						if (confirmed) await refresh();
						setFinding(null);
					}}
				/>
			)}
		</div>
	);
}

function ContactEditor({
	brandId,
	target,
	onDone,
}: {
	brandId: string;
	target: Target;
	onDone: (saved: boolean) => void;
}) {
	const writeError = useWriteErrorMessage();
	const [phone, setPhone] = useState(target.phone ?? "");
	const [address, setAddress] = useState(target.address ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const save = async (event: React.FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await saveBusinessContactFn({ data: { brandId, competitorName: target.competitorName, phone, address } });
			onDone(true);
		} catch (err) {
			setError(writeError(err, "Couldn't save the phone and address."));
			setBusy(false);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Phone and Address of {target.name}</CardTitle>
				<CardDescription>
					As the business publishes them, not copied from Google. Leave both empty to clear them.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={save} className="space-y-3">
					<Input
						value={phone}
						onChange={(event) => setPhone(event.target.value)}
						placeholder="(919) 555-0100"
						aria-label="Phone"
					/>
					<Input
						value={address}
						onChange={(event) => setAddress(event.target.value)}
						placeholder="1 Main St, Raleigh, NC 27601"
						aria-label="Address"
					/>
					{error && <p className="text-destructive text-sm">{error}</p>}
					<div className="flex gap-2">
						<Button type="submit" disabled={busy}>
							Save
						</Button>
						<Button type="button" variant="outline" onClick={() => onDone(false)}>
							Cancel
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

function AnchorStatus({ target }: { target: Target }) {
	const anchor = target.anchor;
	if (!anchor) return <Badge variant="outline">Not Anchored</Badge>;
	if (anchor.obsoleteAt) {
		return (
			<div className="space-y-1">
				<Badge variant="destructive">Retired by Google</Badge>
				<div className="text-muted-foreground text-xs">Since {day(anchor.obsoleteAt)}. Find it again.</div>
			</div>
		);
	}
	return (
		<div className="space-y-1">
			<Badge variant="secondary">Anchored</Badge>
			<div className="text-muted-foreground text-xs">
				By {anchor.confirmedBy} on {day(anchor.confirmedAt)}, checked {day(anchor.checkedAt)}
			</div>
		</div>
	);
}

function PlaceFinder({
	brandId,
	target,
	areas,
	onDone,
}: {
	brandId: string;
	target: Target;
	areas: Anchors["areas"];
	onDone: (confirmed: boolean) => void;
}) {
	const writeError = useWriteErrorMessage();
	const primary = areas.find((area) => area.isPrimary) ?? areas[0];
	const [query, setQuery] = useState(target.anchor?.searchQuery ?? target.name);
	const [areaId, setAreaId] = useState<string | undefined>(primary?.id);
	const [result, setResult] = useState<Search | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const search = async (event: React.FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			setResult(await searchPlacesFn({ data: { brandId, query, areaId } }));
		} catch (err) {
			setError(writeError(err, "Couldn't search Google."));
		} finally {
			setBusy(false);
		}
	};

	const confirm = async (candidate: Search["candidates"][number]) => {
		setBusy(true);
		setError(null);
		try {
			await confirmPlaceAnchorFn({
				data: {
					brandId,
					competitorName: target.competitorName,
					placeId: candidate.placeId,
					cid: candidate.cid,
					searchQuery: query,
				},
			});
			onDone(true);
		} catch (err) {
			setError(writeError(err, "Couldn't save the Place ID."));
			setBusy(false);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Find {target.name} on Google</CardTitle>
				<CardDescription>
					Pick the listing that is this business. Check the address and phone: same-named businesses elsewhere show up
					too. Each search costs about $0.035.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<form onSubmit={search} className="flex flex-wrap gap-2">
					<Input
						className="min-w-60 flex-1"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						aria-label="Business Name"
					/>
					{areas.length > 1 && (
						<Select value={areaId} onValueChange={(value) => setAreaId(value ?? undefined)}>
							<SelectTrigger className="w-48" aria-label="Service Area">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{areas.map((area) => (
									<SelectItem key={area.id} value={area.id}>
										{area.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					<Button type="submit" disabled={busy || !query.trim()}>
						Search
					</Button>
					<Button type="button" variant="outline" onClick={() => onDone(false)}>
						Cancel
					</Button>
				</form>
				{areas.length === 0 && (
					<p className="text-muted-foreground text-sm">
						No service areas yet, so the search isn't limited to where this business works.
					</p>
				)}
				{error && <p className="text-destructive text-sm">{error}</p>}

				{result && (
					<div className="space-y-2">
						{result.candidates.length === 0 ? (
							<p className="text-muted-foreground text-sm">Google found nothing for that name.</p>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Listing</TableHead>
										<TableHead>Phone</TableHead>
										<TableHead>Distance</TableHead>
										<TableHead />
									</TableRow>
								</TableHeader>
								<TableBody>
									{result.candidates.map((candidate) => (
										<TableRow key={candidate.placeId}>
											<TableCell>
												<div className="font-medium">
													{candidate.mapsUrl ? (
														<a className="underline" href={candidate.mapsUrl} target="_blank" rel="noreferrer">
															{candidate.name}
														</a>
													) : (
														candidate.name
													)}
												</div>
												<div className="text-muted-foreground text-xs">{candidate.address ?? "No address listed"}</div>
											</TableCell>
											<TableCell className="text-sm">{candidate.phone ?? "—"}</TableCell>
											<TableCell className="text-sm">
												{candidate.distanceMeters === null ? (
													"—"
												) : (
													<div className="space-y-1">
														<div>{(candidate.distanceMeters / METERS_PER_MILE).toFixed(1)} mi</div>
														{candidate.insideArea === false && <Badge variant="outline">Outside Area</Badge>}
													</div>
												)}
											</TableCell>
											<TableCell className="text-right">
												<Button size="sm" disabled={busy} onClick={() => confirm(candidate)}>
													This One
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
						<p className="text-muted-foreground text-xs">
							{result.area ? `Searched near ${result.area.name}. ` : ""}Results from Google Maps
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
