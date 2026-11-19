import { type ChartConfig, ChartContainer, ChartTooltip } from "@workspace/ui/components/chart";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { formatShortDate } from "@/lib/chart-utils";
import { TIER_LABELS } from "@/lib/fidelity-tiers";
import { type Interval, intervalText, pct, plural } from "./shared";

export interface TrendWeek extends Interval {
	weekStart: Date;
	tiers: Record<string, number>;
	tierMixChanged: boolean;
}

const config: ChartConfig = {
	rate: { label: "Mention Rate", color: "var(--color-primary)" },
	band: { label: "95% Interval", color: "var(--color-primary)" },
};

const percent = (value: number | null) => (value === null ? null : Math.round(value * 1000) / 10);

const tierMix = (tiers: Record<string, number>) =>
	Object.entries(tiers)
		.filter(([, count]) => count > 0)
		.map(([tier, count]) => `${TIER_LABELS[tier] ?? tier}: ${count}`);

/** Weekly mention rate with its interval as a band; a dashed line marks a week whose tier mix changed. */
export function MentionTrendChart({ weeks }: { weeks: TrendWeek[] }) {
	const data = weeks.map((week) => ({
		date: week.weekStart.toISOString().slice(0, 10),
		rate: percent(week.rate),
		band: week.low === null || week.high === null ? null : [percent(week.low), percent(week.high)],
		week,
	}));
	return (
		<ChartContainer config={config} className="aspect-auto h-[240px] w-full">
			<ComposedChart data={data} margin={{ top: 16, right: 12, bottom: 0, left: -8 }}>
				<CartesianGrid vertical={false} strokeDasharray="3 3" />
				<XAxis
					dataKey="date"
					tickLine={false}
					axisLine={false}
					tickMargin={8}
					minTickGap={32}
					tick={{ fontSize: 11 }}
					tickFormatter={formatShortDate}
				/>
				<YAxis
					tickLine={false}
					axisLine={false}
					tickMargin={8}
					domain={[0, 100]}
					ticks={[0, 25, 50, 75, 100]}
					tick={{ fontSize: 11 }}
					tickFormatter={(value) => `${value}%`}
				/>
				{data
					.filter(({ week }) => week.tierMixChanged)
					.map(({ date }) => (
						<ReferenceLine
							key={date}
							x={date}
							stroke="#f59e0b"
							strokeDasharray="4 3"
							label={{ value: "Tier Mix", position: "insideTopRight", fontSize: 10, fill: "#d97706" }}
						/>
					))}
				<Area
					dataKey="band"
					stroke="none"
					fill="var(--color-band)"
					fillOpacity={0.15}
					isAnimationActive={false}
					connectNulls
				/>
				<Line
					dataKey="rate"
					stroke="var(--color-rate)"
					strokeWidth={2}
					dot={{ r: 2.5 }}
					isAnimationActive={false}
					connectNulls
				/>
				<ChartTooltip
					isAnimationActive={false}
					cursor={false}
					content={({ active, payload }) => {
						const week = (payload?.[0]?.payload as (typeof data)[number] | undefined)?.week;
						if (!active || !week) return null;
						return (
							<div className="space-y-1 rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
								<p className="font-medium">Week of {formatShortDate(week.weekStart.toISOString().slice(0, 10))}</p>
								{week.trials === 0 ? (
									<p className="text-muted-foreground">No answers</p>
								) : (
									<>
										<p>
											{pct(week.rate)} of {plural(week.trials, "answer")} (95% interval {intervalText(week)})
										</p>
										<p className="text-muted-foreground">{tierMix(week.tiers).join(" · ")}</p>
										{week.tierMixChanged && (
											<p className="text-amber-700">The tier mix changed from the week before.</p>
										)}
									</>
								)}
							</div>
						);
					}}
				/>
			</ComposedChart>
		</ChartContainer>
	);
}
