export const START_GRID_SCANS_QUEUE = "start-grid-scans";
export const GRID_SCAN_RUN_QUEUE = "grid-scan-run";

/** Each job is one run, so a retry pays for that run again and nothing else. */
export const MAX_RUN_ATTEMPTS = 3;

export const GRID_SCAN_RUN_QUEUE_OPTIONS = {
	retryLimit: MAX_RUN_ATTEMPTS,
	retryDelay: 60,
	retryBackoff: true,
	// Outlasts DataForSEO's slowest located AI Overview, which polls an async load.
	expireInSeconds: 30 * 60,
} as const;

/**
 * Runs in flight at once per vendor, across every worker. Jobs are grouped by provider,
 * so one vendor's backlog never holds up another's.
 */
export const VENDOR_CONCURRENCY = {
	default: 4,
	tiers: { dataforseo: 10, "anthropic-api": 4, cloro: 4, searchapi: 4 },
} as const;

export interface GridScanRunData {
	brandId: string;
	scanRunId: string;
}
