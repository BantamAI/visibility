export { DISCOVERY_ACTOR, type Discovered, discoverCompetitors } from "./discover";
export {
	type AreaCompetitors,
	addService,
	CompetitorDiscoveryError,
	getDiscoverySettings,
	listAreaCompetitors,
	listServices,
	removeService,
	saveDiscoverySettings,
	setCompetitorStatus,
	subjectsWithServiceAreas,
} from "./manage";
export { DEFAULT_DISCOVERY_SETTINGS, type DiscoverySettings, trackedInArea } from "./rank";
export { type Seeded, seedCompetitors, seedListings } from "./seed";
export { SERVICE_TAG_PREFIX, serviceTag } from "./tally";

export const DISCOVER_COMPETITORS_QUEUE = "discover-competitors";
