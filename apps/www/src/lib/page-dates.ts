import type { InferPageType } from "fumadocs-core/source";
import type { source } from "@/lib/source";

export type DatedPage = InferPageType<typeof source>;

// OpenAPI has no last-modified field, so the generated API reference pages are dated here. Bump it when the spec changes.
const API_REFERENCE_UPDATED = "2026-11-03";

export function newest(dates: (string | undefined)[]): string | undefined {
	return dates
		.filter((date): date is string => Boolean(date))
		.sort()
		.at(-1);
}

export function pageLastUpdated(page: DatedPage): string | undefined {
	if (page.type === "openapi") return API_REFERENCE_UPDATED;
	return page.data.updated;
}
