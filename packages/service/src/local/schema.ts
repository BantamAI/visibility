import { brands } from "@workspace/lib/db/schema";
import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	doublePrecision,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	smallint,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export type Position = [lng: number, lat: number];
export type AreaPolygon =
	| { type: "Polygon"; coordinates: Position[][] }
	| { type: "MultiPolygon"; coordinates: Position[][][] };

export const subjectServiceAreas = pgTable(
	"subject_service_areas",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		subjectId: text("subject_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		name: text("name").notNull(),
		centerLat: doublePrecision("center_lat").notNull(),
		centerLng: doublePrecision("center_lng").notNull(),
		radiusMeters: integer("radius_meters").notNull(),
		polygon: jsonb("polygon").$type<AreaPolygon>(),
		isPrimary: boolean("is_primary").default(false).notNull(),
		timezone: text("timezone").notNull(),
		country: text("country").default("US").notNull(),
		gridSize: smallint("grid_size").default(3).notNull(),
		zipPointLimit: smallint("zip_point_limit").default(12).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("subject_service_areas_subject_id_idx").on(table.subjectId),
		unique("subject_service_areas_id_subject_id_key").on(table.id, table.subjectId),
		uniqueIndex("subject_service_areas_subject_id_name_idx").on(table.subjectId, table.name),
		uniqueIndex("subject_service_areas_one_primary_idx").on(table.subjectId).where(sql`${table.isPrimary}`),
		check("subject_service_areas_center_lat_check", sql`${table.centerLat} BETWEEN -90 AND 90`),
		check("subject_service_areas_center_lng_check", sql`${table.centerLng} BETWEEN -180 AND 180`),
		check("subject_service_areas_radius_check", sql`${table.radiusMeters} BETWEEN 100 AND 200000`),
		check("subject_service_areas_grid_size_check", sql`${table.gridSize} BETWEEN 3 AND 7`),
		check("subject_service_areas_zip_point_limit_check", sql`${table.zipPointLimit} BETWEEN 1 AND 50`),
	],
).enableRLS();

export const samplePointKind = pgEnum("sample_point_kind", ["centroid", "grid", "zip"]);
export type SamplePointKind = (typeof samplePointKind.enumValues)[number];

/**
 * Everything a provider needs to send a location is resolved when the point is
 * made, so adapters never geocode at run time. Points are deactivated rather than
 * deleted, since runs will reference them by id.
 */
export const samplePoints = pgTable(
	"sample_points",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		subjectId: text("subject_id").notNull(),
		areaId: uuid("area_id").notNull(),
		kind: samplePointKind("kind").notNull(),
		label: text("label").notNull(),
		lat: doublePrecision("lat").notNull(),
		lng: doublePrecision("lng").notNull(),
		city: text("city"),
		region: text("region"),
		country: text("country").notNull(),
		postalCode: text("postal_code"),
		timezone: text("timezone").notNull(),
		googleCanonicalName: text("google_canonical_name"),
		active: boolean("active").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("sample_points_subject_id_idx").on(table.subjectId),
		uniqueIndex("sample_points_area_id_kind_label_idx").on(table.areaId, table.kind, table.label),
		// Ties each point to an area of the same subject.
		foreignKey({
			name: "sample_points_area_fk",
			columns: [table.areaId, table.subjectId],
			foreignColumns: [subjectServiceAreas.id, subjectServiceAreas.subjectId],
		}).onDelete("cascade"),
	],
).enableRLS();

/** Census gazetteer places (public domain), joined to Google's geotargets list at load time. */
export const refUsPlaces = pgTable(
	"ref_us_places",
	{
		geoid: text("geoid").primaryKey().notNull(),
		name: text("name").notNull(),
		state: text("state").notNull(),
		lat: doublePrecision("lat").notNull(),
		lng: doublePrecision("lng").notNull(),
		landAreaM2: bigint("land_area_m2", { mode: "number" }).notNull(),
		googleCanonicalName: text("google_canonical_name"),
		vintage: smallint("vintage").notNull(),
	},
	(table) => [index("ref_us_places_lat_lng_idx").on(table.lat, table.lng)],
).enableRLS();

/**
 * Census ZCTA gazetteer points (public domain) with 2020 Decennial Census population,
 * which the gazetteer lacks. ZCTAs approximate USPS ZIP codes.
 */
export const refUsZctas = pgTable(
	"ref_us_zctas",
	{
		zcta: text("zcta").primaryKey().notNull(),
		lat: doublePrecision("lat").notNull(),
		lng: doublePrecision("lng").notNull(),
		landAreaM2: bigint("land_area_m2", { mode: "number" }).notNull(),
		population: integer("population"),
		vintage: smallint("vintage").notNull(),
		populationVintage: smallint("population_vintage"),
	},
	(table) => [index("ref_us_zctas_lat_lng_idx").on(table.lat, table.lng)],
).enableRLS();

export type ServiceArea = typeof subjectServiceAreas.$inferSelect;
export type SamplePoint = typeof samplePoints.$inferSelect;
export type RefUsPlace = typeof refUsPlaces.$inferSelect;
export type RefUsZcta = typeof refUsZctas.$inferSelect;
