/** The normal quantile for a two-sided 95% interval. */
const Z_95 = 1.959964;

export interface Proportion {
	successes: number;
	trials: number;
	/** Null with no trials, as are the bounds. */
	rate: number | null;
	low: number | null;
	high: number | null;
}

/**
 * A proportion with its Wilson score interval, which stays inside [0, 1] and keeps a sensible
 * width at small counts and at rates near 0 or 1, where the normal approximation doesn't.
 */
export function wilsonInterval(successes: number, trials: number, z = Z_95): Proportion {
	if (trials === 0) return { successes, trials, rate: null, low: null, high: null };
	const p = successes / trials;
	const z2 = z * z;
	const denominator = 1 + z2 / trials;
	const center = (p + z2 / (2 * trials)) / denominator;
	const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
	return {
		successes,
		trials,
		rate: p,
		low: successes === 0 ? 0 : Math.max(0, center - half),
		high: successes === trials ? 1 : Math.min(1, center + half),
	};
}
