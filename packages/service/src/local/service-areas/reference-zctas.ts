import { readGazetteer } from "./reference-places";

export type GazetteerZcta = {
	zcta: string;
	lat: number;
	lng: number;
	landAreaM2: number;
};

export function parseGazetteerZctas(text: string): GazetteerZcta[] {
	return readGazetteer(text, ["GEOID", "ALAND", "INTPTLAT", "INTPTLONG"]).map((row) => ({
		zcta: row.GEOID,
		lat: Number(row.INTPTLAT),
		lng: Number(row.INTPTLONG),
		landAreaM2: Number(row.ALAND),
	}));
}

export type ZctaPopulation = { vintage: number | null; byZcta: Map<string, number> };

/**
 * Reads total population (`P1_001N`) by ZCTA from a Census table response: either
 * data.census.gov's `{ response: { data, objectId } }`, whose object id carries the
 * year, or api.census.gov's bare array of rows.
 */
export function parseZctaPopulation(json: string): ZctaPopulation {
	const parsed: unknown = JSON.parse(json);
	const response = Array.isArray(parsed) ? { data: parsed } : (parsed as { response?: unknown }).response;
	const { data, objectId } = (response ?? {}) as { data?: unknown; objectId?: unknown };
	if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error("The population file has no table rows");
	const [header, ...rows] = data as string[][];
	const population = header.indexOf("P1_001N");
	const geoId = header.indexOf("GEO_ID");
	const zctaColumn = header.indexOf("zip code tabulation area");
	if (population < 0 || (geoId < 0 && zctaColumn < 0)) {
		throw new Error("The population file needs P1_001N and a GEO_ID or zip code tabulation area column");
	}
	const byZcta = new Map<string, number>();
	for (const row of rows) {
		const zcta = zctaColumn >= 0 ? row[zctaColumn] : row[geoId]?.split("US").pop();
		const count = Number(row[population]);
		if (zcta && /^\d{5}$/.test(zcta) && Number.isInteger(count)) byZcta.set(zcta, count);
	}
	const year = typeof objectId === "string" ? objectId.match(/(\d{4})/)?.[1] : undefined;
	return { vintage: year ? Number(year) : null, byZcta };
}
