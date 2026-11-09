import type { FidelityTier, RunLocation } from "../../src/providers/types";

/** What a route does to its vendor's outgoing request to place the run. */
export interface OutgoingRequest {
	url: URL;
	method: string;
	body: unknown;
}

export interface Route {
	id: string;
	engine: string;
	provider: string;
	/** The tier the routing table hopes for; the bake-off decides whether it holds. */
	claimedTier: FidelityTier;
	/** Coordinate routes take each sample point; centroid routes only take a city or state. */
	grid: "coordinate" | "centroid";
	method: string;
	/** Published price per answered run. */
	estUsdPerRun: number;
	/** Cloro bills credits from a monthly allowance. */
	estCredits?: number;
	/** Applies the location to the one request that starts the run; polls and follow-ups pass through. */
	place?(request: OutgoingRequest, location: RunLocation): boolean;
}

const DFS_HOST = "api.dataforseo.com";
const CLORO_TASK_PATH = "/v1/async/task";
const BD_TRIGGER_PATH = "/datasets/v3/trigger";
const SEARCHAPI_PATH = "/api/v1/search";

/** DataForSEO caps coordinates at 7 decimals; the radius is the smallest it accepts, so the point stays a point. */
const DFS_RADIUS = 200;
const coordinate = (location: RunLocation) =>
	`${location.latitude.toFixed(7)},${location.longitude.toFixed(7)},${DFS_RADIUS}`;
/** AI Mode takes a zoom where the others take a radius. */
const DFS_AI_MODE_ZOOM = "15z";

function dfsPlace(
	endpoint: string,
	value: (location: RunLocation) => string,
	field: "location_coordinate" | "location_name" = "location_coordinate",
) {
	return (request: OutgoingRequest, location: RunLocation) => {
		if (request.url.host !== DFS_HOST || !request.url.pathname.includes(endpoint)) return false;
		const tasks = request.body as Record<string, unknown>[];
		for (const task of tasks) {
			delete task.location_code;
			delete task.location_name;
			task[field] = value(location);
		}
		return true;
	};
}

function cloroPlace(taskType: string, fields: (location: RunLocation) => Record<string, string>) {
	return (request: OutgoingRequest, location: RunLocation) => {
		if (request.method !== "POST" || request.url.pathname !== CLORO_TASK_PATH) return false;
		const body = request.body as { taskType: string; payload: Record<string, unknown> };
		if (body.taskType !== taskType) return false;
		Object.assign(body.payload, fields(location));
		// The search-queries add-on costs 2 credits a run and the bake-off doesn't read queries.
		if (taskType === "CHATGPT") body.payload.include = { markdown: true };
		return true;
	};
}

const cloroCanonical = (location: RunLocation) => ({ location: requireField(location, "googleCanonicalName") });
const cloroState = (location: RunLocation) => ({ state: requireField(location, "region") });

function requireField(location: RunLocation, field: "googleCanonicalName" | "region" | "city"): string {
	const value = location[field];
	if (!value) throw new Error(`Point ${location.pointId} has no ${field}`);
	return value;
}

function searchapiPlace(engine: string, apply: (params: URLSearchParams, location: RunLocation) => void) {
	return (request: OutgoingRequest, location: RunLocation) => {
		const params = request.url.searchParams;
		if (request.url.pathname !== SEARCHAPI_PATH || params.get("engine") !== engine || params.has("page_token")) {
			return false;
		}
		params.delete("gl");
		apply(params, location);
		return true;
	};
}

function brightdataPlace(request: OutgoingRequest, location: RunLocation) {
	if (request.method !== "POST" || request.url.pathname !== BD_TRIGGER_PATH) return false;
	// The ChatGPT scraper refuses `country: "us"`, so the point goes alone.
	for (const input of request.body as Record<string, unknown>[]) {
		input.geolocation = `${location.latitude},${location.longitude}`;
	}
	return true;
}

export const ROUTES: readonly Route[] = [
	{
		id: "google-ai-mode:dataforseo",
		engine: "google-ai-mode",
		provider: "dataforseo",
		claimedTier: "T1",
		grid: "coordinate",
		method: "location_coordinate (lat,lng,zoom)",
		estUsdPerRun: 0.004,
		place: dfsPlace(
			"/serp/google/ai_mode/",
			(l) => `${l.latitude.toFixed(7)},${l.longitude.toFixed(7)},${DFS_AI_MODE_ZOOM}`,
		),
	},
	{
		id: "google-ai-overview:dataforseo",
		engine: "google-ai-overview",
		provider: "dataforseo",
		claimedTier: "T1",
		grid: "coordinate",
		method: "location_coordinate (lat,lng,radius), load_async_ai_overview",
		// $0.002 a SERP plus $0.002 to load the overview.
		estUsdPerRun: 0.004,
		place: dfsPlace("/serp/google/organic/", coordinate),
	},
	{
		id: "google-ai-overview:searchapi",
		engine: "google-ai-overview",
		provider: "searchapi",
		claimedTier: "T1",
		grid: "coordinate",
		method: "latitude and longitude",
		// A second search redeems the overview's page token when Google defers it.
		estUsdPerRun: 0.006,
		place: searchapiPlace("google", (params, l) => {
			params.set("latitude", String(l.latitude));
			params.set("longitude", String(l.longitude));
		}),
	},
	{
		id: "chatgpt:brightdata",
		engine: "chatgpt",
		provider: "brightdata",
		claimedTier: "T1",
		grid: "coordinate",
		method: "geolocation (lat,lng), only in the vendor's samples",
		estUsdPerRun: 0.0015,
		place: brightdataPlace,
	},
	{
		id: "chatgpt:dataforseo",
		engine: "chatgpt",
		provider: "dataforseo",
		claimedTier: "T1",
		grid: "coordinate",
		method: "location_coordinate (lat,lng,radius), undocumented for ChatGPT",
		estUsdPerRun: 0.004,
		place: dfsPlace("/chat_gpt/llm_scraper/", coordinate),
	},
	{
		id: "gemini:dataforseo",
		engine: "gemini",
		provider: "dataforseo",
		claimedTier: "T1",
		grid: "coordinate",
		method: "location_coordinate (lat,lng,radius)",
		estUsdPerRun: 0.004,
		place: dfsPlace("/gemini/llm_scraper/", coordinate),
	},
	{
		id: "gemini:dataforseo:city",
		engine: "gemini",
		provider: "dataforseo",
		claimedTier: "T2",
		grid: "centroid",
		method: "location_name (Google canonical name)",
		estUsdPerRun: 0.004,
		place: dfsPlace("/gemini/llm_scraper/", (l) => requireField(l, "googleCanonicalName"), "location_name"),
	},
	{
		id: "google-ai-mode:searchapi",
		engine: "google-ai-mode",
		provider: "searchapi",
		claimedTier: "T1",
		grid: "centroid",
		method: "location (Google canonical name)",
		estUsdPerRun: 0.004,
		place: searchapiPlace("google_ai_mode", (params, l) =>
			params.set("location", requireField(l, "googleCanonicalName")),
		),
	},
	{
		id: "google-ai-mode:cloro",
		engine: "google-ai-mode",
		provider: "cloro",
		claimedTier: "T1",
		grid: "centroid",
		method: "location (Google canonical name)",
		estUsdPerRun: 0.0032,
		estCredits: 4,
		place: cloroPlace("AIMODE", cloroCanonical),
	},
	{
		id: "google-ai-overview:cloro",
		engine: "google-ai-overview",
		provider: "cloro",
		claimedTier: "T1",
		grid: "centroid",
		method: "location (Google canonical name)",
		estUsdPerRun: 0.004,
		estCredits: 5,
		place: cloroPlace("GOOGLE", cloroCanonical),
	},
	{
		id: "chatgpt:cloro",
		engine: "chatgpt",
		provider: "cloro",
		claimedTier: "T3",
		grid: "centroid",
		method: "state",
		estUsdPerRun: 0.0056,
		estCredits: 7,
		place: cloroPlace("CHATGPT", cloroState),
	},
	{
		id: "gemini:cloro",
		engine: "gemini",
		provider: "cloro",
		claimedTier: "T3",
		grid: "centroid",
		method: "state",
		estUsdPerRun: 0.0048,
		estCredits: 6,
		place: cloroPlace("GEMINI", cloroState),
	},
	{
		id: "perplexity:cloro",
		engine: "perplexity",
		provider: "cloro",
		claimedTier: "T3",
		grid: "centroid",
		method: "state",
		estUsdPerRun: 0.0048,
		estCredits: 6,
		place: cloroPlace("PERPLEXITY", cloroState),
	},
	{
		id: "perplexity:brightdata",
		engine: "perplexity",
		provider: "brightdata",
		claimedTier: "T5",
		grid: "centroid",
		method: "none: the dataset refuses geolocation, so only the vendor's US egress",
		estUsdPerRun: 0.0015,
	},
	{
		id: "claude:anthropic-api",
		engine: "claude",
		provider: "anthropic-api",
		claimedTier: "T4",
		grid: "centroid",
		method: "web_search user_location plus a system prompt (the shipped E53-S26 route)",
		// One search plus Sonnet tokens; checked against the console after the run.
		estUsdPerRun: 0.04,
	},
];

export function getRoute(id: string): Route {
	const route = ROUTES.find((candidate) => candidate.id === id);
	if (!route) throw new Error(`Unknown route "${id}". Known: ${ROUTES.map((r) => r.id).join(", ")}`);
	return route;
}
