import { IconInfoCircle } from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import type { ReactNode } from "react";

export interface Interval {
	successes: number;
	trials: number;
	rate: number | null;
	low: number | null;
	high: number | null;
}

export const pct = (value: number | null) => (value === null ? "–" : `${Math.round(value * 100)}%`);

export const plural = (count: number, word: string) => `${count.toLocaleString()} ${count === 1 ? word : `${word}s`}`;

export const intervalText = ({ low, high }: Interval) =>
	low === null || high === null ? "No answers" : `${pct(low)}–${pct(high)}`;

export function InfoTip({ children }: { children: ReactNode }) {
	return (
		<Tooltip>
			<TooltipTrigger render={<IconInfoCircle className="size-3.5 cursor-help text-muted-foreground" />} />
			<TooltipContent className="max-w-xs text-sm font-normal">{children}</TooltipContent>
		</Tooltip>
	);
}

/** The rate as a dot on a 0–100% track, with its 95% interval as a band around it. */
export function IntervalBar({ interval }: { interval: Interval }) {
	const { rate, low, high } = interval;
	return (
		<div
			className="relative h-2 w-full min-w-24 rounded-full bg-muted"
			role="img"
			aria-label={rate === null ? "No answers" : `${pct(rate)}, 95% interval ${intervalText(interval)}`}
		>
			{low !== null && high !== null && (
				<div
					className="absolute inset-y-0 rounded-full bg-primary/25"
					style={{ left: `${low * 100}%`, width: `${Math.max((high - low) * 100, 1)}%` }}
				/>
			)}
			{rate !== null && (
				<div
					className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-background"
					style={{ left: `${rate * 100}%` }}
				/>
			)}
		</div>
	);
}

export const PHRASING_LABELS: Record<string, string> = {
	"near-me": "Near Me",
	"city-named": "City-Named",
	other: "Other",
};
