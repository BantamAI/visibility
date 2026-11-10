import type { DbConnection } from "@workspace/lib/db/db-connection";
import type { MentionConfig } from "@workspace/lib/mentions";
import { and, eq, inArray } from "drizzle-orm";
import { businessContacts, samplePoints, subjectServiceAreas } from "../schema";
import { distanceMeters } from "../service-areas/geo";

/** Enough for the judge to tell the market apart from a namesake's; a big metro has dozens. */
const MAX_CITIES_PER_AREA = 8;

export interface AreaForContext {
	name: string;
	/** "City, ST", nearest the area's center first. */
	cities: string[];
}

export interface Contact {
	phone: string | null;
	address: string | null;
}

/** As answers write North American numbers, so the judge can tell it's the same one. */
function readablePhone(phone: string): string {
	const nanp = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
	return nanp ? `(${nanp[1]}) ${nanp[2]}-${nanp[3]}` : phone;
}

/** What the judge is told about where a local business is, after its name and website. */
export function describeWhereabouts(areas: AreaForContext[], contact: Contact | undefined): string {
	const served = areas
		.map(({ name, cities }) => (cities.length ? `${name} (${cities.join("; ")})` : name))
		.join(", and ");
	const address = contact?.address ? `, at ${contact.address}` : "";
	const phone = contact?.phone ? `, phone ${readablePhone(contact.phone)}` : "";
	return `It's the business of that name serving ${served}${address}${phone}.`;
}

export interface LocalContexts {
	subject: string;
	/** By lower-cased competitor name. */
	competitors: Map<string, string>;
}

/** Gives a local subject and each competitor their whereabouts; a config without contexts is left as it was. */
export function localizeMentionConfig(config: MentionConfig, contexts: LocalContexts | undefined): MentionConfig {
	if (!contexts) return config;
	return {
		brand: { ...config.brand, localContext: contexts.subject },
		competitors: config.competitors.map((competitor) => ({
			...competitor,
			localContext: contexts.competitors.get(competitor.name.trim().toLowerCase()) ?? contexts.subject,
		})),
	};
}

/**
 * The whereabouts of each local subject among `subjectIds` (every subject the scope reaches when
 * omitted), and of its competitors, which compete in the same areas. A subject with no service
 * area isn't local and has none, so its questions stay as they were.
 */
export async function loadLocalContexts(
	conn: DbConnection,
	subjectIds?: string[],
): Promise<Map<string, LocalContexts>> {
	if (subjectIds?.length === 0) return new Map();
	const [areas, centroids, contacts] = await Promise.all([
		conn
			.select()
			.from(subjectServiceAreas)
			.where(subjectIds ? inArray(subjectServiceAreas.subjectId, subjectIds) : undefined),
		conn
			.select({
				areaId: samplePoints.areaId,
				city: samplePoints.city,
				region: samplePoints.region,
				lat: samplePoints.lat,
				lng: samplePoints.lng,
			})
			.from(samplePoints)
			.where(
				and(
					eq(samplePoints.kind, "centroid"),
					eq(samplePoints.active, true),
					subjectIds ? inArray(samplePoints.subjectId, subjectIds) : undefined,
				),
			),
		conn
			.select()
			.from(businessContacts)
			.where(subjectIds ? inArray(businessContacts.subjectId, subjectIds) : undefined),
	]);
	const bySubject = new Map<string, AreaForContext[]>();
	const ordered = [...areas].sort(
		(a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.getTime() - b.createdAt.getTime(),
	);
	for (const area of ordered) {
		const center = { lat: area.centerLat, lng: area.centerLng };
		const cities = centroids
			.filter((point) => point.areaId === area.id && point.city)
			.sort((a, b) => distanceMeters(center, a) - distanceMeters(center, b))
			.map((point) => (point.region ? `${point.city}, ${point.region}` : (point.city as string)));
		const unique = [...new Set(cities)].slice(0, MAX_CITIES_PER_AREA);
		bySubject.set(area.subjectId, [...(bySubject.get(area.subjectId) ?? []), { name: area.name, cities: unique }]);
	}
	const contexts = new Map<string, LocalContexts>();
	for (const [subjectId, subjectAreas] of bySubject) {
		const own = contacts.filter((contact) => contact.subjectId === subjectId);
		contexts.set(subjectId, {
			subject: describeWhereabouts(
				subjectAreas,
				own.find((contact) => contact.competitorName === null),
			),
			competitors: new Map(
				own.flatMap((contact) =>
					contact.competitorName === null
						? []
						: [[contact.competitorName.trim().toLowerCase(), describeWhereabouts(subjectAreas, contact)]],
				),
			),
		});
	}
	return contexts;
}
