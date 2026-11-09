import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { OVERSPEND_FACTOR } from "@workspace/service/local/vendor-spend/limits";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { useState } from "react";
import { pageHead } from "@/lib/route-head";
import { useWriteErrorMessage } from "@/lib/write-errors";
import { getVendorSpendFn, resumeVendorFn } from "@/server/vendor-spend";

export const Route = createFileRoute("/_authed/admin/vendor-spend")({
	staticData: { crumb: "Vendor Spend" },
	head: pageHead({ description: "Each vendor's spend today against its plan, and vendors stopped for overspending." }),
	component: VendorSpendPage,
});

type Row = Awaited<ReturnType<typeof getVendorSpendFn>>[number];

const usd = (value: number) => `$${value.toFixed(value < 1 ? 3 : 2)}`;

function VendorSpendPage() {
	const queryClient = useQueryClient();
	const writeError = useWriteErrorMessage();
	const [resuming, setResuming] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const { data: rows, isLoading } = useQuery({
		queryKey: ["vendor-spend"],
		queryFn: () => getVendorSpendFn(),
		refetchInterval: 60_000,
	});

	const resume = async (provider: string) => {
		setError(null);
		setResuming(provider);
		try {
			await resumeVendorFn({ data: { provider } });
			await queryClient.invalidateQueries({ queryKey: ["vendor-spend"] });
		} catch (err) {
			setError(writeError(err, "Failed to resume the vendor."));
		} finally {
			setResuming(null);
		}
	};

	return (
		<div className="space-y-6">
			<div>
				<h1 className="font-semibold text-2xl">Vendor Spend</h1>
				<p className="text-muted-foreground">
					A vendor's plan for the day is every enabled scan on it starting once. When its spend since midnight UTC runs
					past {OVERSPEND_FACTOR}× that plan, it's stopped: it runs nothing, and its scans wait, until you resume it.
					Spend before a resume no longer counts that day.
				</p>
			</div>
			<Card>
				<CardHeader>
					<CardTitle>Today</CardTitle>
					<CardDescription>Checked every 5 minutes.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{error && <p className="text-destructive text-sm">{error}</p>}
					{isLoading ? (
						<p className="text-muted-foreground">Loading...</p>
					) : !rows || rows.length === 0 ? (
						<p className="text-muted-foreground">No vendor has a plan or any spend today.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Vendor</TableHead>
									<TableHead className="text-right">Spend</TableHead>
									<TableHead className="text-right">Plan</TableHead>
									<TableHead className="text-right">Limit</TableHead>
									<TableHead>Status</TableHead>
									<TableHead />
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((row) => (
									<VendorRow
										key={row.provider}
										row={row}
										resuming={resuming === row.provider}
										onResume={() => resume(row.provider)}
									/>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function VendorRow({ row, resuming, onResume }: { row: Row; resuming: boolean; onResume: () => void }) {
	return (
		<TableRow>
			<TableCell>{row.name}</TableCell>
			<TableCell className="text-right">{usd(row.spendUsd)}</TableCell>
			<TableCell className="text-right">{usd(row.planUsd)}</TableCell>
			<TableCell className="text-right">{usd(row.limitUsd)}</TableCell>
			<TableCell>
				{row.stop ? (
					<span className="space-x-2">
						<Badge variant="destructive">Stopped</Badge>
						<span className="text-muted-foreground text-sm">
							{new Date(row.stop.stoppedAt).toLocaleString()} at {usd(row.stop.spendUsd)} of {usd(row.stop.planUsd)}{" "}
							planned
						</span>
					</span>
				) : (
					<Badge variant="secondary">Running</Badge>
				)}
			</TableCell>
			<TableCell className="text-right">
				{row.stop && (
					<Button size="sm" variant="outline" disabled={resuming} onClick={onResume}>
						{resuming ? "Resuming..." : "Resume"}
					</Button>
				)}
			</TableCell>
		</TableRow>
	);
}
