import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MAX_ZIP_POINTS } from "@workspace/service/local/service-areas/geo";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Switch } from "@workspace/ui/components/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { Textarea } from "@workspace/ui/components/textarea";
import { useState } from "react";
import { useBrandId } from "@/hooks/use-brand-id";
import { pageHead } from "@/lib/route-head";
import { useWriteErrorMessage } from "@/lib/write-errors";
import { deleteServiceAreaFn, getServiceAreas, saveServiceAreaFn } from "@/server/service-areas";

export const Route = createFileRoute("/_authed/app/org/$org/brand/$brand/settings/service-areas")({
	staticData: { crumb: "Service Areas" },
	head: pageHead({ description: "Manage the areas local runs sample from." }),
	component: ServiceAreasSettingsPage,
});

type ServiceAreaRow = Awaited<ReturnType<typeof getServiceAreas>>[number];

const METERS_PER_MILE = 1609.344;
const TIME_ZONES = {
	"America/New_York": "Eastern",
	"America/Chicago": "Central",
	"America/Denver": "Mountain",
	"America/Phoenix": "Arizona",
	"America/Los_Angeles": "Pacific",
	"America/Anchorage": "Alaska",
	"Pacific/Honolulu": "Hawaii",
};
const GRID_SIZES = Object.fromEntries([3, 4, 5, 6, 7].map((n) => [String(n), `${n} × ${n}`]));

type Draft = {
	name: string;
	centerLat: string;
	centerLng: string;
	radiusMiles: string;
	timezone: string;
	gridSize: string;
	zipPointLimit: string;
	isPrimary: boolean;
	polygon: string;
};

const emptyDraft: Draft = {
	name: "",
	centerLat: "",
	centerLng: "",
	radiusMiles: "10",
	timezone: "America/New_York",
	gridSize: "3",
	zipPointLimit: "12",
	isPrimary: false,
	polygon: "",
};

function draftFrom(area: ServiceAreaRow): Draft {
	return {
		name: area.name,
		centerLat: String(area.centerLat),
		centerLng: String(area.centerLng),
		radiusMiles: String(Math.round((area.radiusMeters / METERS_PER_MILE) * 10) / 10),
		timezone: area.timezone,
		gridSize: String(area.gridSize),
		zipPointLimit: String(area.zipPointLimit),
		isPrimary: area.isPrimary,
		polygon: area.polygon ? JSON.stringify(area.polygon) : "",
	};
}

function ServiceAreasSettingsPage() {
	const brandId = useBrandId();
	const queryClient = useQueryClient();
	const queryKey = ["service-areas", brandId];
	const { data: areas = [], isLoading } = useQuery({
		queryKey,
		queryFn: () => getServiceAreas({ data: { brandId } }),
		enabled: !!brandId,
	});
	const [editing, setEditing] = useState<{ areaId?: string; draft: Draft } | null>(null);

	const remove = async (areaId: string) => {
		await deleteServiceAreaFn({ data: { brandId, areaId } });
		await queryClient.invalidateQueries({ queryKey });
	};

	return (
		<div className="max-w-4xl space-y-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold">Service Areas</h1>
					<p className="text-muted-foreground">
						Where this business works. Local runs sample from the grid, city and ZIP points made for each area.
					</p>
				</div>
				{!editing && <Button onClick={() => setEditing({ draft: emptyDraft })}>Add Service Area</Button>}
			</div>

			{editing && (
				<ServiceAreaForm
					brandId={brandId}
					areaId={editing.areaId}
					initial={editing.draft}
					onDone={async (saved) => {
						if (saved) await queryClient.invalidateQueries({ queryKey });
						setEditing(null);
					}}
				/>
			)}

			{isLoading ? (
				<p className="text-muted-foreground">Loading...</p>
			) : areas.length === 0 && !editing ? (
				<p className="text-muted-foreground">No service areas yet.</p>
			) : (
				areas.map((area) => (
					<ServiceAreaCard
						key={area.id}
						area={area}
						onEdit={() => setEditing({ areaId: area.id, draft: draftFrom(area) })}
						onDelete={() => remove(area.id)}
					/>
				))
			)}
		</div>
	);
}

function ServiceAreaCard({
	area,
	onEdit,
	onDelete,
}: {
	area: ServiceAreaRow;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const points = area.samplePoints.filter((point) => point.active);
	const grid = points.filter((point) => point.kind === "grid").length;
	const centroids = points.filter((point) => point.kind === "centroid").length;
	const zips = points.filter((point) => point.kind === "zip").length;
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					{area.name}
					{area.isPrimary && <Badge variant="secondary">Primary</Badge>}
				</CardTitle>
				<CardDescription>
					{area.centerLat}, {area.centerLng} · {(area.radiusMeters / METERS_PER_MILE).toFixed(1)} mi · {area.timezone} ·{" "}
					{grid} grid points ({area.gridSize} × {area.gridSize}) · {centroids} cities · {zips} ZIPs
					{area.polygon ? " · clipped to boundary" : ""}
				</CardDescription>
				<CardAction className="flex gap-2">
					<Button variant="outline" size="sm" onClick={onEdit}>
						Edit
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							if (window.confirm(`Delete ${area.name} and its sample points?`)) onDelete();
						}}
					>
						Delete
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Point</TableHead>
							<TableHead>Kind</TableHead>
							<TableHead>City</TableHead>
							<TableHead>ZIP</TableHead>
							<TableHead>Coordinates</TableHead>
							<TableHead>Google Location</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{points.map((point) => (
							<TableRow key={point.id}>
								<TableCell>{point.label}</TableCell>
								<TableCell className="capitalize">{point.kind}</TableCell>
								<TableCell>{point.city ? `${point.city}, ${point.region}` : "—"}</TableCell>
								<TableCell>{point.postalCode ?? "—"}</TableCell>
								<TableCell className="font-mono text-xs">
									{point.lat.toFixed(5)}, {point.lng.toFixed(5)}
								</TableCell>
								<TableCell className="text-muted-foreground">{point.googleCanonicalName ?? "—"}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}

function ServiceAreaForm({
	brandId,
	areaId,
	initial,
	onDone,
}: {
	brandId: string;
	areaId?: string;
	initial: Draft;
	onDone: (saved: boolean) => void;
}) {
	const writeError = useWriteErrorMessage();
	const [draft, setDraft] = useState(initial);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

	const save = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		let polygon: unknown;
		if (draft.polygon.trim()) {
			try {
				polygon = JSON.parse(draft.polygon);
			} catch {
				setError("The boundary isn't valid JSON.");
				return;
			}
		}
		setSaving(true);
		try {
			await saveServiceAreaFn({
				data: {
					brandId,
					areaId,
					area: {
						name: draft.name,
						centerLat: Number(draft.centerLat),
						centerLng: Number(draft.centerLng),
						radiusMeters: Number(draft.radiusMiles) * METERS_PER_MILE,
						timezone: draft.timezone,
						gridSize: Number(draft.gridSize),
						zipPointLimit: Number(draft.zipPointLimit),
						isPrimary: draft.isPrimary,
						polygon,
					},
				},
			});
			onDone(true);
		} catch (err) {
			setError(writeError(err, "Failed to save the service area."));
		} finally {
			setSaving(false);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{areaId ? "Edit Service Area" : "New Service Area"}</CardTitle>
				<CardDescription>Copy the center from a map. Saving regenerates the area's sample points.</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
					<div className="space-y-2 sm:col-span-2">
						<Label htmlFor="area-name">Name</Label>
						<Input id="area-name" value={draft.name} onChange={(e) => set("name", e.target.value)} required />
					</div>
					<div className="space-y-2">
						<Label htmlFor="area-lat">Center Latitude</Label>
						<Input
							id="area-lat"
							inputMode="decimal"
							value={draft.centerLat}
							onChange={(e) => set("centerLat", e.target.value)}
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="area-lng">Center Longitude</Label>
						<Input
							id="area-lng"
							inputMode="decimal"
							value={draft.centerLng}
							onChange={(e) => set("centerLng", e.target.value)}
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="area-radius">Radius (Miles)</Label>
						<Input
							id="area-radius"
							inputMode="decimal"
							value={draft.radiusMiles}
							onChange={(e) => set("radiusMiles", e.target.value)}
							required
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="area-timezone">Time Zone</Label>
						<Select
							items={TIME_ZONES}
							value={draft.timezone}
							onValueChange={(value) => set("timezone", value as string)}
						>
							<SelectTrigger id="area-timezone" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Object.entries(TIME_ZONES).map(([zone, label]) => (
									<SelectItem key={zone} value={zone}>
										{label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-2">
						<Label htmlFor="area-grid">Grid Size</Label>
						<Select
							items={GRID_SIZES}
							value={draft.gridSize}
							onValueChange={(value) => set("gridSize", value as string)}
						>
							<SelectTrigger id="area-grid" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Object.entries(GRID_SIZES).map(([size, label]) => (
									<SelectItem key={size} value={size}>
										{label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-2">
						<Label htmlFor="area-zips">ZIP Points</Label>
						<Input
							id="area-zips"
							type="number"
							min={1}
							max={MAX_ZIP_POINTS}
							value={draft.zipPointLimit}
							onChange={(e) => set("zipPointLimit", e.target.value)}
							required
						/>
					</div>
					<div className="flex items-center gap-2 self-end pb-2">
						<Switch
							id="area-primary"
							checked={draft.isPrimary}
							onCheckedChange={(checked) => set("isPrimary", checked)}
						/>
						<Label htmlFor="area-primary">Primary Area</Label>
					</div>
					<div className="space-y-2 sm:col-span-2">
						<Label htmlFor="area-polygon">Boundary (Optional GeoJSON)</Label>
						<Textarea
							id="area-polygon"
							rows={3}
							className="font-mono text-xs"
							placeholder='{"type": "Polygon", "coordinates": [[[lng, lat], ...]]}'
							value={draft.polygon}
							onChange={(e) => set("polygon", e.target.value)}
						/>
					</div>
					{error && <p className="text-destructive text-sm sm:col-span-2">{error}</p>}
					<div className="flex gap-2 sm:col-span-2">
						<Button type="submit" disabled={saving}>
							{saving ? "Saving..." : "Save"}
						</Button>
						<Button type="button" variant="outline" disabled={saving} onClick={() => onDone(false)}>
							Cancel
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
