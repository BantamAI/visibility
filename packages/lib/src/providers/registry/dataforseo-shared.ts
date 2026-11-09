import * as client from "dataforseo-client";
import { getCredential } from "../../secrets";
import { configuredWhen } from "../config";
import type { ScrapeResult } from "../types";
import { type Attempt, nonEmptyStrings } from "./scrape-shared";

/**
 * Shared plumbing for the DataForSEO provider, which spans three products on
 * one set of account credentials: the SERP endpoints, AI Optimization "LLM
 * Scraper", and AI Optimization "LLM Responses".
 */

const MAX_PROMPT_CHARS = 500;

// Country localization is intentionally not exposed via SCRAPE_TARGETS yet
// because support differs by DataForSEO surface and underlying model.
export const DFS_LOCATION_CODE = 2840;
export const DFS_LANGUAGE_CODE = "en";

export const isDataforseoConfigured = configuredWhen("DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD");

const DFS_STATUS_OK = 20000;

// Non-generic on purpose: the SDK gives every endpoint its own result class, so
// a generic task type makes a union of two endpoints' responses unassignable.
// The caller names the handful of fields it reads instead.
interface DfsTask {
	id?: string;
	status_code?: number;
	status_message?: string;
	result?: unknown[] | null;
}

export interface DfsResponse {
	cost?: number;
	tasks?: DfsTask[];
}

/** The SERP endpoints' `location_coordinate`: AI Mode takes a map zoom, the organic SERP a radius in meters. */
export function dfsLocationCoordinate(
	point: { latitude: number; longitude: number },
	scale: "ai-mode" | "organic",
): string {
	// DataForSEO rejects more than 7 decimals. 200 m is the smallest radius it accepts, so the point stays a point.
	return `${point.latitude.toFixed(7)},${point.longitude.toFixed(7)},${scale === "ai-mode" ? "15z" : "200"}`;
}

/**
 * The point Google was asked from, read from the `uule` in the result's
 * `check_url`. DataForSEO jitters the point it was sent, by about 70 meters
 * typically and under 150, so this is the location the answer really reflects.
 */
export function googleReportedPoint(checkUrl: unknown): { latitude: number; longitude: number } | undefined {
	if (typeof checkUrl !== "string") return undefined;
	let uule: string | null;
	try {
		uule = new URL(checkUrl).searchParams.get("uule");
	} catch {
		return undefined;
	}
	// "a " marks the text-protobuf form that carries a lat/lng; other forms name a place.
	if (!uule?.startsWith("a ")) return undefined;
	const decoded = Buffer.from(uule.slice(2), "base64").toString("utf8");
	const latitude = /latitude_e7:\s*(-?\d+)/.exec(decoded)?.[1];
	const longitude = /longitude_e7:\s*(-?\d+)/.exec(decoded)?.[1];
	if (!latitude || !longitude) return undefined;
	return { latitude: Number(latitude) / 1e7, longitude: Number(longitude) / 1e7 };
}

/** The vendor's run id, cost and reported location for a successful SERP response. */
export function dfsRunDetails(
	response: DfsResponse | null,
): Pick<ScrapeResult, "vendorRunId" | "costUsd" | "vendorReportedLocation"> {
	const task = response?.tasks?.[0];
	const point = googleReportedPoint((task?.result?.[0] as { check_url?: unknown } | undefined)?.check_url);
	return {
		...(task?.id ? { vendorRunId: task.id } : {}),
		...(typeof response?.cost === "number" ? { costUsd: response.cost } : {}),
		...(point ? { vendorReportedLocation: point } : {}),
	};
}

export function dfsResultOrError<T>(response: DfsResponse | undefined | null): Attempt<T> {
	const task = response?.tasks?.[0];
	if (!task) return { error: "No response or tasks." };
	if (task.status_code !== DFS_STATUS_OK || !task.result?.length) {
		return { error: `${task.status_code} ${task.status_message}` };
	}
	return { result: task.result[0] as T };
}

export function dfsFirstResult<T>(response: DfsResponse | undefined | null): T {
	const outcome = dfsResultOrError<T>(response);
	if ("error" in outcome) throw new Error(`DataForSEO API Error: ${outcome.error}`);
	return outcome.result;
}

export function fanOutQueries(result: { fan_out_queries?: unknown }): string[] {
	return nonEmptyStrings(result.fan_out_queries);
}

function authFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
	const username = getCredential("DATAFORSEO_LOGIN");
	const password = getCredential("DATAFORSEO_PASSWORD");
	if (!username || !password) {
		throw new Error("DataForSEO requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD");
	}
	const token = btoa(`${username}:${password}`);
	return fetch(url, {
		...init,
		headers: { ...init?.headers, Authorization: `Basic ${token}`, "Content-Type": "application/json" },
	});
}

export function createDfsSerpApi() {
	return new client.SerpApi("https://api.dataforseo.com", { fetch: authFetch });
}

export function createDfsAiApi() {
	return new client.AiOptimizationApi("https://api.dataforseo.com", { fetch: authFetch });
}

export function assertPromptLength(prompt: string) {
	const length = Array.from(prompt).length;
	if (length > MAX_PROMPT_CHARS) {
		throw new Error(`DataForSEO prompts must be ${MAX_PROMPT_CHARS} characters or fewer (${length} provided)`);
	}
}
