import spec from "@workspace/api-spec";
import { DEFAULT_APP_NAME } from "@workspace/config/constants";
import type { OpenAPIV3_2 } from "fumadocs-openapi";
import { createOpenAPI } from "fumadocs-openapi/server";

/**
 * The relative server in the spec would resolve against this docs site, which
 * serves no API, so the pages show a placeholder host. An instance serving its
 * own spec fills the host in from the request instead.
 */
export const hostedSpec = {
	...spec,
	servers: [{ url: "https://chatspy.example.com/api/v1", description: `${DEFAULT_APP_NAME} API` }],
};

export const openapi = createOpenAPI({
	// fumadocs-openapi v11 replaced the `() => SchemaMap` factory with a record
	// of `name -> string | Document | (() => Awaitable<...>)`.
	input: { "elmo-api": hostedSpec as OpenAPIV3_2.Document },
});
