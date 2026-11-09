import { createServerFn } from "@tanstack/react-start";
import { parseScrapeTargets } from "@workspace/config/scrape-targets";
import { describeProvider } from "@workspace/lib/providers";
import { resumeVendor, vendorSpendToday } from "@workspace/service/local/vendor-spend";
import { z } from "zod";
import { isAdmin, requireAuthSession } from "@/lib/auth/helpers";

async function requireAdmin() {
	const session = await requireAuthSession();
	if (!isAdmin(session)) throw new Error("Unauthorized: Admin access required");
	return session;
}

/** Spend can outlive its provider's removal from the registry. */
function providerName(id: string): string {
	try {
		return describeProvider(id).name;
	} catch {
		return id;
	}
}

export const getVendorSpendFn = createServerFn({ method: "GET" }).handler(async () => {
	await requireAdmin();
	const rows = await vendorSpendToday(parseScrapeTargets(process.env.SCRAPE_TARGETS));
	return rows.map((row) => ({
		...row,
		name: providerName(row.provider),
		stop: row.stop && { ...row.stop, stoppedAt: row.stop.stoppedAt.toISOString() },
	}));
});

export const resumeVendorFn = createServerFn({ method: "POST" })
	.validator(z.object({ provider: z.string().min(1) }))
	.handler(async ({ data }) => {
		const session = await requireAdmin();
		await resumeVendor(data.provider, session.user.email);
	});
