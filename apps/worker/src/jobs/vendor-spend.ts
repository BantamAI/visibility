import * as Sentry from "@sentry/node";
import { parseScrapeTargets } from "@workspace/config/scrape-targets";
import { checkVendorSpend, OVERSPEND_FACTOR, type VendorSpend } from "@workspace/service/local/vendor-spend";

function reportStop({ provider, spendUsd, planUsd }: VendorSpend): void {
	const message = `Stopped ${provider}: $${spendUsd.toFixed(2)} spent today against a plan of $${planUsd.toFixed(2)} (limit ${OVERSPEND_FACTOR}×). Resume it on the admin Vendor Spend page.`;
	console.error(`[vendor-spend] ${message}`);
	Sentry.withScope((scope) => {
		scope.setLevel("error");
		scope.setTag("scheduler", "vendor-spend-stop");
		scope.setTag("provider", provider);
		scope.setFingerprint(["vendor-spend-stop", provider]);
		Sentry.captureMessage(message, "error");
	});
}

/** Runs with agency access, since a vendor's spend and plan span every subject. */
export async function checkVendorSpendJob(): Promise<void> {
	const stopped = await checkVendorSpend(parseScrapeTargets(process.env.SCRAPE_TARGETS));
	for (const stop of stopped) reportStop(stop);
}
