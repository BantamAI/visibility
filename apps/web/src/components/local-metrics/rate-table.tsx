import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import type { ReactNode } from "react";
import { type Interval, IntervalBar, intervalText, pct } from "./shared";

export interface RateTableRow extends Interval {
	key: string;
}

/** Mention rate per value of one dimension, each with its interval. */
export function RateTable({
	title,
	dimension,
	rows,
	label,
}: {
	title: string;
	dimension: string;
	rows: RateTableRow[];
	label: (key: string) => ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm font-medium">{title}</CardTitle>
			</CardHeader>
			<CardContent>
				{rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">No answers in this period.</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{dimension}</TableHead>
								<TableHead className="text-right">Answers</TableHead>
								<TableHead className="text-right">Rate</TableHead>
								<TableHead className="w-2/5">95% Interval</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<TableRow key={row.key}>
									<TableCell className="font-medium">{label(row.key)}</TableCell>
									<TableCell className="text-right tabular-nums">{row.trials.toLocaleString()}</TableCell>
									<TableCell className="text-right tabular-nums">{pct(row.rate)}</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											<IntervalBar interval={row} />
											<span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
												{intervalText(row)}
											</span>
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
