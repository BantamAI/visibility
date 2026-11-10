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
		/** What its `local_mentions` were derived from (see `localMentionsStamp`); null until they are. */
		localMentionsStamp: text("local_mentions_stamp"),
		/** The extraction version its `answer_named_businesses` were listed with; null until they are. */
		namedBusinessesVersion: smallint("named_businesses_version"),
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

/**
 * The Place ID a subject (no `competitor_name`) or one of its tracked competitors is anchored on,
 * as staff confirmed it. Elmo replaces a brand's competitor rows on every save, so competitors are
 * matched by name, case-insensitively. Google lets Place IDs be kept indefinitely; nothing else
 * from Google is stored here, and the CID is read from the place's Maps link.
 */
export const placeAnchors = pgTable(
	"place_anchors",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		subjectId: text("subject_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		competitorName: text("competitor_name"),
		placeId: text("place_id").notNull(),
		cid: text("cid"),
		/** What found it, re-run when Google retires the ID. */
		searchQuery: text("search_query").notNull(),
		confirmedBy: text("confirmed_by").notNull(),
		confirmedAt: timestamp("confirmed_at", { withTimezone: true }).defaultNow().notNull(),
		/** When Google last said the ID is current. */
		checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
		/** When Google said the ID no longer exists; it needs confirming again. */
		obsoleteAt: timestamp("obsolete_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("place_anchors_subject_id_idx").on(table.subjectId),
		uniqueIndex("place_anchors_subject_idx").on(table.subjectId).where(sql`${table.competitorName} IS NULL`),
		uniqueIndex("place_anchors_competitor_idx")
			.on(table.subjectId, sql`lower(${table.competitorName})`)
			.where(sql`${table.competitorName} IS NOT NULL`),
		index("place_anchors_checked_at_idx").on(table.checkedAt),
		check(
			"place_anchors_competitor_name_check",
			sql`${table.competitorName} IS NULL OR btrim(${table.competitorName}) <> ''`,
		),
	],
).enableRLS();

export type PlaceAnchor = typeof placeAnchors.$inferSelect;

/**
 * The phone and address of the subject (no `competitor_name`) or one of its tracked competitors,
 * as staff entered them or the facts sync filled them, never copied from a cached Google response.
 * Keyed like `place_anchors`: competitors by name, case-insensitively.
 */
export const businessContacts = pgTable(
	"business_contacts",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		subjectId: text("subject_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		competitorName: text("competitor_name"),
		/** E.164. */
		phone: text("phone"),
		address: text("address"),
		updatedBy: text("updated_by").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("business_contacts_subject_id_idx").on(table.subjectId),
		uniqueIndex("business_contacts_subject_idx").on(table.subjectId).where(sql`${table.competitorName} IS NULL`),
		uniqueIndex("business_contacts_competitor_idx")
			.on(table.subjectId, sql`lower(${table.competitorName})`)
			.where(sql`${table.competitorName} IS NOT NULL`),
		check(
			"business_contacts_competitor_name_check",
			sql`${table.competitorName} IS NULL OR btrim(${table.competitorName}) <> ''`,
		),
		check("business_contacts_phone_check", sql`${table.phone} ~ '^\\+[0-9]{8,15}$'`),
		check("business_contacts_address_check", sql`${table.address} IS NULL OR btrim(${table.address}) <> ''`),
	],
).enableRLS();

export type BusinessContact = typeof businessContacts.$inferSelect;

export const localMatchMethod = pgEnum("local_match_method", [
	"place_id",
	"cid",
	"phone",
	"url",
	"text+jev",
	"resolved",
]);
export type LocalMatchMethod = (typeof localMatchMethod.enumValues)[number];

/**
 * Why a row needs a person's eye: `unresolved`, counted on the judge's word alone; `doubtful`, a name
 * the judge couldn't rule out, uncounted; `other_listing`, counted for a card of the same name nearby
 * that isn't the anchored listing; `namesake_card`, uncounted for a card of a namesake elsewhere;
 * `namesake_place`, uncounted because Google places the name the answer gives only outside the areas.
 */
export const localMentionReview = pgEnum("local_mention_review", [
	"unresolved",
	"doubtful",
	"other_listing",
	"namesake_card",
	"namesake_place",
]);
export type LocalMentionReview = (typeof localMentionReview.enumValues)[number];

/**
 * How a located run's answer names the subject (no `competitor_name`) and each tracked competitor:
 * one row per business it names or shows a card for, derived from the run's cards and the mention
 * judge's assessments, so it's rebuilt whenever either changes. The trigger sets `subject_id`.
 */
export const localMentions = pgTable(
	"local_mentions",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		runId: uuid("run_id")
			.references(() => promptRuns.id, { onDelete: "cascade" })
			.notNull(),
		subjectId: text("subject_id").notNull(),
		competitorName: text("competitor_name"),
		/** Whether it counts as a mention of this business; false keeps a namesake for review and evaluation. */
		counted: boolean("counted").notNull(),
		method: localMatchMethod("method").notNull(),
		confidence: doublePrecision("confidence").notNull(),
		review: localMentionReview("review"),
		/** The card that matched, for a structured match. */
		cardPlacement: cardPlacement("card_placement"),
		cardPosition: smallint("card_position"),
	},
	(table) => [
		index("local_mentions_subject_id_idx").on(table.subjectId),
		uniqueIndex("local_mentions_run_subject_idx").on(table.runId).where(sql`${table.competitorName} IS NULL`),
		uniqueIndex("local_mentions_run_competitor_idx")
			.on(table.runId, sql`lower(${table.competitorName})`)
			.where(sql`${table.competitorName} IS NOT NULL`),
		check("local_mentions_confidence_check", sql`${table.confidence} BETWEEN 0 AND 1`),
		check("local_mentions_card_check", sql`(${table.cardPlacement} IS NULL) = (${table.cardPosition} IS NULL)`),
	],
).enableRLS();

export type LocalMention = typeof localMentions.$inferSelect;

/**
 * The businesses a located run's answer text names, as an LLM lists them, in the order named. Derived
 * from the run's text, so a new extraction version lists them again. The trigger sets `subject_id`.
 * `name_key` joins a name to its `place_resolutions`.
 */
export const answerNamedBusinesses = pgTable(
	"answer_named_businesses",
	{
		runId: uuid("run_id")
			.references(() => promptRuns.id, { onDelete: "cascade" })
			.notNull(),
		subjectId: text("subject_id").notNull(),
		position: smallint("position").notNull(),
		name: text("name").notNull(),
		nameKey: text("name_key").notNull(),
		/** E.164, as the answer gives it. */
		phone: text("phone"),
		/** Where the answer places it: a street address, or the city it lists it in. */
		address: text("address"),
		website: text("website"),
	},
	(table) => [
		primaryKey({ name: "answer_named_businesses_pk", columns: [table.runId, table.position] }),
		index("answer_named_businesses_subject_id_name_key_idx").on(table.subjectId, table.nameKey),
		check("answer_named_businesses_position_check", sql`${table.position} >= 1`),
		check("answer_named_businesses_name_key_check", sql`btrim(${table.nameKey}) <> ''`),
		check("answer_named_businesses_phone_check", sql`${table.phone} ~ '^\\+[0-9]{8,15}$'`),
	],
).enableRLS();

export type AnswerNamedBusiness = typeof answerNamedBusinesses.$inferSelect;

/**
 * `matched`: a listing of that name (and phone, if the answer gave one) in or near the subject's areas;
 * `elsewhere`: listings of that name only outside them; `none`: no listing of that name.
 */
export const placeResolution = pgEnum("place_resolution", ["matched", "elsewhere", "none"]);
export type PlaceResolution = (typeof placeResolution.enumValues)[number];

/**
 * What Places Text Search found for a name an answer gives, with the phone and address it gives, near
 * the subject's areas, so each is looked up once rather than once per answer. Google lets Place IDs
 * be kept indefinitely; nothing else from the response is stored. The address is the answer's.
 */
export const placeResolutions = pgTable(
	"place_resolutions",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		subjectId: text("subject_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		nameKey: text("name_key").notNull(),
		/** E.164; null when the answer gave none. */
		phone: text("phone"),
		address: text("address"),
		resolution: placeResolution("resolution").notNull(),
		placeId: text("place_id"),
		cid: text("cid"),
		searchQuery: text("search_query").notNull(),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("place_resolutions_subject_id_idx").on(table.subjectId),
		uniqueIndex("place_resolutions_subject_name_idx").on(
			table.subjectId,
			table.nameKey,
			sql`coalesce(${table.phone}, '')`,
			sql`coalesce(${table.address}, '')`,
		),
		check("place_resolutions_matched_check", sql`(${table.resolution} = 'matched') = (${table.placeId} IS NOT NULL)`),
		check("place_resolutions_phone_check", sql`${table.phone} ~ '^\\+[0-9]{8,15}$'`),
	],
).enableRLS();

export type PlaceResolutionRecord = typeof placeResolutions.$inferSelect;

/**
 * What a subject sells, such as "plumber" or "water heater repair". Competitors are seeded by
 * searching Google for each service in each area, and a prompt tagged `service:<name>` counts
 * toward that service.
 */
export const subjectServices = pgTable(
	"subject_services",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		subjectId: text("subject_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		name: text("name").notNull(),
		/** Specific jobs people ask for under this service, such as "water heater replacement". */
		jobs: text("jobs").array().notNull().default([]),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("subject_services_subject_id_idx").on(table.subjectId),
		unique("subject_services_id_subject_id_key").on(table.id, table.subjectId),
		uniqueIndex("subject_services_subject_name_idx").on(table.subjectId, sql`lower(${table.name})`),
		check("subject_services_name_check", sql`btrim(${table.name}) <> '' AND ${table.name} = btrim(${table.name})`),
	],
).enableRLS();

export type SubjectService = typeof subjectServices.$inferSelect;

/** How a subject's competitors are discovered; a subject without a row uses the defaults. */
export const competitorDiscoverySettings = pgTable(
	"competitor_discovery_settings",
	{
		subjectId: text("subject_id")
			.primaryKey()
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		/** Runs of one service in one area that must name a business before it's tracked. */
		minRuns: smallint("min_runs").notNull(),
		/** Automatic competitors tracked per area, besides pinned ones. */
		perArea: smallint("per_area").notNull(),
		/** How far back runs count. */
		windowDays: smallint("window_days").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		check("competitor_discovery_settings_min_runs_check", sql`${table.minRuns} BETWEEN 1 AND 100`),
		check("competitor_discovery_settings_per_area_check", sql`${table.perArea} BETWEEN 1 AND 50`),
		check("competitor_discovery_settings_window_days_check", sql`${table.windowDays} BETWEEN 7 AND 365`),
	],
).enableRLS();

/** One Places search for a service in an area, so each pair is searched once. */
export const competitorSeedSearches = pgTable(
	"competitor_seed_searches",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		subjectId: text("subject_id").notNull(),
		areaId: uuid("area_id").notNull(),
		serviceId: uuid("service_id").notNull(),
		searchQuery: text("search_query").notNull(),
		/** Listings kept from the search: near the area, and not the subject. */
		found: smallint("found").notNull(),
		searchedAt: timestamp("searched_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("competitor_seed_searches_subject_id_idx").on(table.subjectId),
		uniqueIndex("competitor_seed_searches_area_service_idx").on(table.areaId, table.serviceId),
		foreignKey({
			name: "competitor_seed_searches_area_fk",
			columns: [table.areaId, table.subjectId],
			foreignColumns: [subjectServiceAreas.id, subjectServiceAreas.subjectId],
		}).onDelete("cascade"),
		foreignKey({
			name: "competitor_seed_searches_service_fk",
			columns: [table.serviceId, table.subjectId],
			foreignColumns: [subjectServices.id, subjectServices.subjectId],
		}).onDelete("cascade"),
	],
).enableRLS();

/** `auto`: tracked while it ranks among the area's top; `pinned`: always tracked; `ignored`: never. */
export const areaCompetitorStatus = pgEnum("area_competitor_status", ["auto", "pinned", "ignored"]);
export type AreaCompetitorStatus = (typeof areaCompetitorStatus.enumValues)[number];

/**
 * A business that competes with the subject in one of its areas, by Place ID: found by seeding from
 * Places or named in the area's answers. Tracked ones are kept in Elmo's `competitors` under `name`,
 * so the judge looks for them; reports read which areas each is tracked in from here.
 */
export const areaCompetitors = pgTable(
	"area_competitors",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		subjectId: text("subject_id").notNull(),
		areaId: uuid("area_id").notNull(),
		placeId: text("place_id").notNull(),
		cid: text("cid"),
		/** Set when the row is made and kept, since Elmo's competitors and anchors are keyed by it. */
		name: text("name").notNull(),
		/** Other names the area's answers give it, most often first. */
		aliases: text("aliases").array().notNull().default([]),
		website: text("website"),
		status: areaCompetitorStatus("status").default("auto").notNull(),
		statusBy: text("status_by"),
		statusAt: timestamp("status_at", { withTimezone: true }),
		/** Its place in Google's results for the best-ranked service it was seeded for; null when not seeded. */
		seedRank: smallint("seed_rank"),
		/** Distinct runs in the area, within the window, that name it. */
		answerRuns: integer("answer_runs").default(0).notNull(),
		/** The services it was seeded for or named in runs of. */
		services: text("services").array().notNull().default([]),
		tracked: boolean("tracked").default(false).notNull(),
		/** Discovery added Elmo's competitor of this name, so it removes it once no area tracks it. */
		ownsCompetitor: boolean("owns_competitor").default(false).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("area_competitors_subject_id_idx").on(table.subjectId),
		uniqueIndex("area_competitors_area_place_idx").on(table.areaId, table.placeId),
		foreignKey({
			name: "area_competitors_area_fk",
			columns: [table.areaId, table.subjectId],
			foreignColumns: [subjectServiceAreas.id, subjectServiceAreas.subjectId],
		}).onDelete("cascade"),
		check("area_competitors_name_check", sql`btrim(${table.name}) <> ''`),
		check("area_competitors_answer_runs_check", sql`${table.answerRuns} >= 0`),
		check("area_competitors_status_check", sql`(${table.status} = 'auto') = (${table.statusBy} IS NULL)`),
	],
).enableRLS();

export type AreaCompetitor = typeof areaCompetitors.$inferSelect;
