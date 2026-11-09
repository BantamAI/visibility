import type { ScanSpec } from "../grid-scans/plan-scans";

/** A vendor whose day's spend runs past this multiple of its plan is stopped. */
export const OVERSPEND_FACTOR = 2;

export interface VendorSpend {
	provider: string;
	spendUsd: number;
	planUsd: number;
}

/**
 * The most each vendor's scans can cost in a day: no interval is shorter than a day, so
 * at worst every scan starts once.
 */
export function dailyPlanByVendor(
	specs: readonly Pick<ScanSpec, "config" | "estimatedCostUsd">[],
): Map<string, number> {
	const plan = new Map<string, number>();
	for (const spec of specs) {
		const provider = spec.config.provider;
		plan.set(provider, (plan.get(provider) ?? 0) + (spec.estimatedCostUsd ?? 0));
	}
	return plan;
}

const microdollars = (usd: number) => Math.round(usd * 1_000_000);

/** A vendor with spend but no plan is over it: nothing enabled should have spent there. */
export function overspentVendors(spend: ReadonlyMap<string, number>, plan: ReadonlyMap<string, number>): VendorSpend[] {
	return [...spend].flatMap(([provider, spendUsd]) => {
		const planUsd = plan.get(provider) ?? 0;
		const over = microdollars(spendUsd) > microdollars(planUsd * OVERSPEND_FACTOR);
		return spendUsd > 0 && over ? [{ provider, spendUsd, planUsd }] : [];
	});
}
