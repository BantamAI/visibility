import { brands, promptRuns, prompts } from "@workspace/lib/db/schema";
import type { RunLocation } from "@workspace/lib/providers";
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
	numeric,
	pgEnum,
	pgTable,
	primaryKey,
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

export const fidelityTier = pgEnum("fidelity_tier", ["T1", "T2", "T3", "T4", "T5"]);
export const locationMethod = pgEnum("location_method", [
	"geo_coordinate",
	"egress_city",
	"egress_region",
	"api_user_location",
	"prompt_only",
]);
export const runCostSource = pgEnum("run_cost_source", ["vendor", "estimate"]);

/**
 * Where a located run asked to come from and how faithfully it got there, one row per
 * run; brand-mode runs have none. Kept beside Elmo's `prompt_runs` rather than in it.
 * The trigger sets `subject_id` from the run. `requested_location` is a snapshot, so
 * `point_id` has no foreign key and outlives its point.
 */
export const runLocations = pgTable(
	"run_locations",
	{
		runId: uuid("run_id")
			.primaryKey()
			.references(() => promptRuns.id, { onDelete: "cascade" }),
		subjectId: text("subject_id").notNull(),
		pointId: uuid("point_id").notNull(),
		requestedLocation: jsonb("requested_location").$type<RunLocation>().notNull(),
		locationMethod: locationMethod("location_method").notNull(),
		fidelityTier: fidelityTier("fidelity_tier").notNull(),
		vendorReportedLocation: jsonb("vendor_reported_location").$type<Record<string, unknown>>(),
		vendorRunId: text("vendor_run_id"),
		costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
		costSource: runCostSource("cost_source"),
		/** The parser version its `answer_businesses` were derived with; null until they are. */
		businessesVersion: smallint("businesses_version"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("run_locations_subject_id_idx").on(table.subjectId),
		index("run_locations_businesses_version_idx").on(table.businessesVersion),
		check(
			"run_locations_method_matches_tier_check",
			sql`(${table.fidelityTier}, ${table.locationMethod}) IN (('T1', 'geo_coordinate'), ('T2', 'egress_city'), ('T3', 'egress_region'), ('T4', 'api_user_location'), ('T5', 'prompt_only'))`,
		),
		check("run_locations_cost_source_check", sql`(${table.costUsd} IS NULL) = (${table.costSource} IS NULL)`),
	],
).enableRLS();

export const cardPlacement = pgEnum("card_placement", ["answer", "local_pack"]);

/**
 * The business cards in a located run's answer, normalized across vendors and derived from
 * its `raw_output`, so a parser fix rebuilds them. The trigger sets `subject_id` from the run.
 */
export const answerBusinesses = pgTable(
	"answer_businesses",
	{
		runId: uuid("run_id")
			.references(() => promptRuns.id, { onDelete: "cascade" })
			.notNull(),
		subjectId: text("subject_id").notNull(),
		placement: cardPlacement("placement").notNull(),
		position: smallint("position").notNull(),
		name: text("name").notNull(),
		placeId: text("place_id"),
		cid: text("cid"),
		phone: text("phone"),
		address: text("address"),
		lat: doublePrecision("lat"),
		lng: doublePrecision("lng"),
		rating: doublePrecision("rating"),
		reviewCount: integer("review_count"),
		website: text("website"),
	},
	(table) => [
		primaryKey({ name: "answer_businesses_pk", columns: [table.runId, table.placement, table.position] }),
		index("answer_businesses_subject_id_idx").on(table.subjectId),
		check("answer_businesses_position_check", sql`${table.position} >= 1`),
	],
).enableRLS();

export type AnswerBusiness = typeof answerBusinesses.$inferSelect;

/** A subject's located-run schedule. The run planner refuses to enable one whose plan costs more than its budget. */
export const subjectRunSchedules = pgTable(
	"subject_run_schedules",
	{
		subjectId: text("subject_id")
			.primaryKey()
			.references(() => brands.id, { onDelete: "cascade" }),
		enabled: boolean("enabled").default(false).notNull(),
		monthlyBudgetUsd: numeric("monthly_budget_usd", { precision: 10, scale: 2, mode: "number" }),
		scanIntervalDays: smallint("scan_interval_days").default(7).notNull(),
		centroidIntervalDays: smallint("centroid_interval_days").default(7).notNull(),
		repeats: smallint("repeats").default(1).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("subject_run_schedules_subject_id_idx").on(table.subjectId),
		check("subject_run_schedules_budget_check", sql`${table.monthlyBudgetUsd} >= 0`),
		check(
			"subject_run_schedules_enabled_needs_budget_check",
			sql`NOT ${table.enabled} OR ${table.monthlyBudgetUsd} IS NOT NULL`,
		),
		check("subject_run_schedules_scan_interval_check", sql`${table.scanIntervalDays} BETWEEN 1 AND 31`),
		check("subject_run_schedules_centroid_interval_check", sql`${table.centroidIntervalDays} BETWEEN 1 AND 31`),
		check("subject_run_schedules_repeats_check", sql`${table.repeats} BETWEEN 1 AND 5`),
	],
).enableRLS();

/** A point the scan's route couldn't place: it takes the stand-in's results, or is a gap when there's none. */
export interface UncoveredScanPoint {
	pointId: string;
	label: string;
	lat: number;
	lng: number;
	reason: string;
	standInPointId: string | null;
}

export const gridScanStatus = pgEnum("grid_scan_status", ["running", "complete"]);
export const gridScanRunStatus = pgEnum("grid_scan_run_status", ["pending", "answered", "failed"]);

/**
 * One prompt on one route across every active point of one kind in a service area.
 * `area_id` has no foreign key, so a scan outlives its area.
 */
export const gridScans = pgTable(
	"grid_scans",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		subjectId: text("subject_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		areaId: uuid("area_id").notNull(),
		promptId: uuid("prompt_id")
			.references(() => prompts.id, { onDelete: "cascade" })
			.notNull(),
		model: text("model").notNull(),
		provider: text("provider").notNull(),
		webSearchEnabled: boolean("web_search_enabled").notNull(),
		version: text("version"),
		fidelityTier: fidelityTier("fidelity_tier").notNull(),
		pointKind: samplePointKind("point_kind").notNull(),
		repeats: smallint("repeats").notNull(),
		uncovered: jsonb("uncovered").$type<UncoveredScanPoint[]>().default([]).notNull(),
		estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6, mode: "number" }),
		status: gridScanStatus("status").default("running").notNull(),
		pointsPlanned: integer("points_planned").notNull(),
		pointsAnswered: integer("points_answered"),
		costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(table) => [
		index("grid_scans_subject_id_idx").on(table.subjectId, table.createdAt),
		unique("grid_scans_id_subject_id_key").on(table.id, table.subjectId),
		check("grid_scans_repeats_check", sql`${table.repeats} >= 1`),
		check("grid_scans_points_planned_check", sql`${table.pointsPlanned} >= 1`),
		check(
			"grid_scans_complete_check",
			sql`(${table.status} = 'complete') = (${table.completedAt} IS NOT NULL AND ${table.pointsAnswered} IS NOT NULL)`,
		),
	],
).enableRLS();

/**
 * One run of a scan: a point and a repeat. `location` is a snapshot of the point, so
 * `point_id` has no foreign key, and a failed run still has somewhere on the map.
 */
export const gridScanRuns = pgTable(
	"grid_scan_runs",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		subjectId: text("subject_id").notNull(),
		scanId: uuid("scan_id").notNull(),
		pointId: uuid("point_id").notNull(),
		location: jsonb("location").$type<RunLocation>().notNull(),
		repeat: smallint("repeat").notNull(),
		status: gridScanRunStatus("status").default("pending").notNull(),
		attempts: smallint("attempts").default(0).notNull(),
		runId: uuid("run_id").references(() => promptRuns.id, { onDelete: "cascade" }),
		lastError: text("last_error"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("grid_scan_runs_subject_id_idx").on(table.subjectId),
		uniqueIndex("grid_scan_runs_scan_id_point_id_repeat_idx").on(table.scanId, table.pointId, table.repeat),
		uniqueIndex("grid_scan_runs_run_id_idx").on(table.runId),
		// Ties each run to a scan of the same subject.
		foreignKey({
			name: "grid_scan_runs_scan_fk",
			columns: [table.scanId, table.subjectId],
			foreignColumns: [gridScans.id, gridScans.subjectId],
		}).onDelete("cascade"),
		check("grid_scan_runs_answered_check", sql`(${table.status} = 'answered') = (${table.runId} IS NOT NULL)`),
	],
).enableRLS();

export type ServiceArea = typeof subjectServiceAreas.$inferSelect;
export type SamplePoint = typeof samplePoints.$inferSelect;
export type RefUsPlace = typeof refUsPlaces.$inferSelect;
export type RefUsZcta = typeof refUsZctas.$inferSelect;
export type RunLocationRecord = typeof runLocations.$inferInsert;
export type RunSchedule = typeof subjectRunSchedules.$inferSelect;
export type GridScan = typeof gridScans.$inferSelect;
export type GridScanRun = typeof gridScanRuns.$inferSelect;

/**
 * A vendor whose day's spend ran past twice its plan. It runs nothing until agency staff
 * resume it, and spend before the resume no longer counts against it that day.
 */
export const vendorSpendStops = pgTable(
	"vendor_spend_stops",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		provider: text("provider").notNull(),
		spendUsd: numeric("spend_usd", { precision: 12, scale: 6, mode: "number" }).notNull(),
		planUsd: numeric("plan_usd", { precision: 12, scale: 6, mode: "number" }).notNull(),
		stoppedAt: timestamp("stopped_at", { withTimezone: true }).defaultNow().notNull(),
		resumedAt: timestamp("resumed_at", { withTimezone: true }),
		resumedBy: text("resumed_by"),
	},
	(table) => [
		uniqueIndex("vendor_spend_stops_active_provider_idx").on(table.provider).where(sql`${table.resumedAt} IS NULL`),
		index("vendor_spend_stops_provider_resumed_at_idx").on(table.provider, table.resumedAt),
		check("vendor_spend_stops_resumed_check", sql`(${table.resumedAt} IS NULL) = (${table.resumedBy} IS NULL)`),
	],
).enableRLS();

export type VendorSpendStop = typeof vendorSpendStops.$inferSelect;
