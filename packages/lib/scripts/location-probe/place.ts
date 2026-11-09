import { AsyncLocalStorage } from "node:async_hooks";
import type { RunLocation } from "../../src/providers/types";
import type { OutgoingRequest, Route } from "./routes";

interface Placement {
	route: Route;
	location: RunLocation;
	/** The first request the route placed, as sent, so the results can show what each vendor was told. */
	sent?: { url: string; body: unknown };
}

const current = new AsyncLocalStorage<Placement>();
let installed = false;

/**
 * The adapters send no location below country until their vendor stories land, so
 * the probe adds each route's location fields to the request on its way out.
 * Product code stays untouched; this exists only for the bake-off.
 */
export function installPlacement(): void {
	if (installed) return;
	installed = true;
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const placement = current.getStore();
		// Retries of the starting request are placed again; only the first is kept.
		if (!placement?.route.place || input instanceof Request) return realFetch(input, init);

		const url = new URL(String(input));
		const method = (init?.method ?? "GET").toUpperCase();
		const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		const request: OutgoingRequest = { url, method, body };
		if (!placement.route.place(request, placement.location)) return realFetch(input, init);

		placement.sent ??= { url: redact(url), body: request.body };
		return realFetch(url, { ...init, ...(body === undefined ? {} : { body: JSON.stringify(request.body) }) });
	};
}

function redact(url: URL): string {
	const copy = new URL(url);
	copy.searchParams.delete("api_key");
	return copy.toString();
}

export async function withPlacement<T>(
	route: Route,
	location: RunLocation,
	task: () => Promise<T>,
): Promise<{ result: T; sent?: Placement["sent"] }> {
	const placement: Placement = { route, location };
	const result = await current.run(placement, task);
	if (route.place && !placement.sent) {
		throw new Error(`${route.id} sent no request the probe could place, so the run had no location`);
	}
	return { result, sent: placement.sent };
}
