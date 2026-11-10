import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { pageHead } from "@/lib/route-head";
import { useWriteErrorMessage } from "@/lib/write-errors";
import { addLocalNewsSourceFn, getLocalNewsSourcesFn, removeLocalNewsSourceFn } from "@/server/local-news";

export const Route = createFileRoute("/_authed/admin/local-news")({
	staticData: { crumb: "Local News" },
	head: pageHead({ description: "The news sites, by metro, whose citations count as local news." }),
	component: LocalNewsPage,
});

const QUERY_KEY = ["local-news-sources"];

function LocalNewsPage() {
	const queryClient = useQueryClient();
	const writeError = useWriteErrorMessage();
	const [metro, setMetro] = useState("");
	const [domain, setDomain] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const { data: metros, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: () => getLocalNewsSourcesFn() });

	const run = async (key: string, write: () => Promise<void>, fallback: string) => {
		setError(null);
		setBusy(key);
		try {
			await write();
			await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
			return true;
		} catch (err) {
			setError(writeError(err, fallback));
			return false;
		} finally {
			setBusy(null);
		}
	};

	const add = async (event: FormEvent) => {
		event.preventDefault();
		const added = await run("add", () => addLocalNewsSourceFn({ data: { metro, domain } }), "Failed to add the site.");
		if (added) setDomain("");
	};

	const remove = (id: string) => run(id, () => removeLocalNewsSourceFn({ data: { id } }), "Failed to remove the site.");

	return (
		<div className="space-y-6">
			<div>
				<h1 className="font-semibold text-2xl">Local News</h1>
				<p className="text-muted-foreground">
					Citations of these sites count as local news rather than editorial, for every brand, whichever metro a site is
					listed under. Pages already cited are reclassified as soon as you add or remove a site.
				</p>
			</div>
			<Card>
				<CardHeader>
					<CardTitle>Add a Site</CardTitle>
					<CardDescription>Subdomains count too: adding example.com covers news.example.com.</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="flex flex-wrap items-end gap-3" onSubmit={add}>
						<div className="space-y-1.5">
							<Label htmlFor="local-news-metro">Metro</Label>
							<Input
								id="local-news-metro"
								list="local-news-metros"
								placeholder="Houston, TX"
								value={metro}
								onChange={(event) => setMetro(event.target.value)}
								className="w-56"
							/>
							<datalist id="local-news-metros">
								{metros?.map((group) => (
									<option key={group.metro} value={group.metro} />
								))}
							</datalist>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="local-news-domain">Domain</Label>
							<Input
								id="local-news-domain"
								placeholder="houstonchronicle.com"
								value={domain}
								onChange={(event) => setDomain(event.target.value)}
								className="w-64"
							/>
						</div>
						<Button type="submit" disabled={busy === "add" || !metro.trim() || !domain.trim()}>
							{busy === "add" ? "Adding..." : "Add Site"}
						</Button>
					</form>
					{error && <p className="mt-3 text-destructive text-sm">{error}</p>}
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Sites by Metro</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="text-muted-foreground">Loading...</p>
					) : !metros || metros.length === 0 ? (
						<p className="text-muted-foreground">No local news sites yet.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-56">Metro</TableHead>
									<TableHead>Sites</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{metros.map((group) => (
									<TableRow key={group.metro}>
										<TableCell className="align-top font-medium">{group.metro}</TableCell>
										<TableCell>
											<div className="flex flex-wrap gap-1.5">
												{group.sources.map((source) => (
													<Badge key={source.id} variant="secondary" className="gap-1 pr-1">
														{source.domain}
														<button
															type="button"
															aria-label={`Remove ${source.domain} from ${group.metro}`}
															disabled={busy === source.id}
															onClick={() => remove(source.id)}
															className="rounded-sm p-0.5 hover:bg-muted-foreground/20 disabled:opacity-50"
														>
															<X className="size-3" />
														</button>
													</Badge>
												))}
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
