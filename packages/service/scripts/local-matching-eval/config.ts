import type { AreaForContext } from "../../src/local/local-mentions/context";
import type { MatchableCard } from "../../src/local/local-mentions/match";
import type { NamedBusiness } from "../../src/local/named-businesses/extract";
import type { Resolved } from "../../src/local/named-businesses/resolve";

export type AreaId = "raleigh" | "denver" | "naperville";

interface EvalBusiness {
	name: string;
	aliases: string[];
	/** What staff would search Places for to anchor it. */
	search: string;
	/** True for the area's subject; the rest are its tracked competitors. */
	subject?: boolean;
}

interface EvalArea {
	id: AreaId;
	center: { lat: number; lng: number };
	radiusMeters: number;
	whereabouts: AreaForContext;
	businesses: EvalBusiness[];
}

/**
 * Each SP5-L area as a local subject that tracks businesses its answers name often. The chains, and
 * names such as "Blanton" and "Brothers Plumbing", recur in other areas' answers as different
 * businesses, which is what the eval needs.
 */
export const AREAS: Record<AreaId, EvalArea> = {
	raleigh: {
		id: "raleigh",
		center: { lat: 35.7796, lng: -78.6382 },
		radiusMeters: 16093,
		whereabouts: {
			name: "Raleigh",
			cities: ["Raleigh, NC", "Garner, NC", "Knightdale, NC", "Cary, NC", "Morrisville, NC", "Wake Forest, NC"],
		},
		businesses: [
			{ name: "William Parrish Plumbing", aliases: [], search: "William Parrish Plumbing Raleigh NC", subject: true },
			{ name: "Roto-Rooter", aliases: [], search: "Roto-Rooter Plumbing Raleigh NC" },
			{ name: "Mr. Rooter Plumbing", aliases: ["Mr. Rooter"], search: "Mr. Rooter Plumbing of Raleigh NC" },
			{ name: "Benjamin Franklin Plumbing", aliases: [], search: "Benjamin Franklin Plumbing Raleigh NC" },
			{ name: "Michael & Son", aliases: [], search: "Michael & Son Services Raleigh NC" },
			{ name: "Swift Brothers Plumbing", aliases: ["Swift Brothers"], search: "Swift Brothers Plumbing Raleigh NC" },
		],
	},
	denver: {
		id: "denver",
		center: { lat: 39.7392, lng: -104.9903 },
		radiusMeters: 16093,
		whereabouts: {
			name: "Denver",
			cities: ["Denver, CO", "Glendale, CO", "Englewood, CO", "Lakewood, CO", "Aurora, CO", "Wheat Ridge, CO"],
		},
		businesses: [
			{ name: "Plumbline Services", aliases: [], search: "Plumbline Services Denver CO", subject: true },
			{ name: "Roto-Rooter", aliases: [], search: "Roto-Rooter Plumbing Denver CO" },
			{ name: "Mr. Rooter Plumbing", aliases: ["Mr. Rooter"], search: "Mr. Rooter Plumbing of Denver CO" },
			{ name: "Benjamin Franklin Plumbing", aliases: [], search: "Benjamin Franklin Plumbing Denver CO" },
			{
				name: "Brothers Plumbing",
				aliases: ["Brothers Plumbing, Heating & Electric"],
				search: "Brothers Plumbing Heating & Electric Denver CO",
			},
			{ name: "Applewood Plumbing", aliases: ["Applewood"], search: "Applewood Plumbing Heating & Electric Denver CO" },
		],
	},
	naperville: {
		id: "naperville",
		center: { lat: 41.7508, lng: -88.1535 },
		radiusMeters: 9656,
		whereabouts: {
			name: "Naperville",
			cities: ["Naperville, IL", "Warrenville, IL", "Lisle, IL", "Aurora, IL", "Bolingbrook, IL", "Woodridge, IL"],
		},
		businesses: [
			{
				name: "Bee Quick Plumbing",
				aliases: ["Bee Quick"],
				search: "Bee Quick Plumbing & Sewer Naperville IL",
				subject: true,
			},
			{ name: "Roto-Rooter", aliases: [], search: "Roto-Rooter Plumbing Naperville IL" },
			{ name: "Lacassa Plumbing", aliases: [], search: "Lacassa Plumbing Naperville IL" },
			{ name: "Rootbusters", aliases: [], search: "Rootbusters Plumbing Sewer and Drains Naperville IL" },
			{ name: "Blanton Plumbing", aliases: ["Blanton"], search: "Blanton Plumbing Naperville IL" },
			{ name: "Wiz Plumbing", aliases: [], search: "Wiz Plumbing Naperville IL" },
		],
	},
};

export interface EvalSet {
	/** By "area|business name": what staff would confirm on the Place IDs page. */
	anchors: Record<string, { placeId: string; cid: string | null }>;
	/** Census ZCTA points for the ZIPs on the answers' cards, as `ref_us_zctas` has them. */
	zips: Record<string, { lat: number; lng: number }>;
	runs: {
		id: string;
		area: AreaId;
		route: string;
		prompt: string;
		text: string;
		cards: MatchableCard[];
	}[];
	/** One per tracked business an answer names, judged as `judgedAs`'s answer would be. */
	items: {
		run: string;
		judgedAs: AreaId;
		business: string;
		/** Whether the answer means this business: the hand label. */
		mentioned: boolean;
		note: string;
	}[];
}

/** What `resolve.ts` found: the businesses each answer names, and the listing each name is near an area. */
export interface NamedSet {
	/** By run id. */
	extractions: Record<string, NamedBusiness[]>;
	/** By `resolutionKey`. */
	resolutions: Record<string, Resolved>;
}

export const resolutionKey = (area: AreaId, business: Pick<NamedBusiness, "nameKey" | "phone" | "address">) =>
	`${area}|${business.nameKey}|${business.phone ?? ""}|${business.address ?? ""}`;
