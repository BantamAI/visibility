import { createServerFn } from "@tanstack/react-start";
import {
	addService,
	discoverCompetitors,
	getDiscoverySettings,
	listAreaCompetitors,
	listServices,
	removeService,
	saveDiscoverySettings,
	seedCompetitors,
	setCompetitorStatus,
} from "@workspace/service/local/competitor-discovery";
import { withSubject } from "@workspace/service/local/tenancy";
import { configuredPlacesProvider } from "@workspace/service/providers/places";
import { z } from "zod";
import { requireBrandSession } from "@/lib/auth/helpers";

/** Enough for every service in every area of a new subject; the daily Places allowance still applies. */
const SEARCHES_PER_REQUEST = 20;

const placesConfigured = () => Boolean(process.env.GOOGLE_PLACES_API_KEY);

/** Seeds what's new when Google is set up, then ranks again, so the page shows the result straight away. */
async function seedAndDiscover(subjectId: string) {
	if (placesConfigured()) await seedCompetitors(configuredPlacesProvider(), subjectId, SEARCHES_PER_REQUEST);
	await discoverCompetitors(subjectId);
}

export const getCompetitorDiscovery = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		return withSubject(data.brandId, async () => {
			const [services, settings, areas] = await Promise.all([
				listServices(data.brandId),
				getDiscoverySettings(data.brandId),
				listAreaCompetitors(data.brandId),
			]);
			return {
				configured: placesConfigured(),
				services: services.map(({ id, name }) => ({ id, name })),
				settings,
				areas: areas.map(({ area, competitors }) => ({
					area,
					competitors: competitors.map((row) => ({
						id: row.id,
						placeId: row.placeId,
						name: row.name,
						aliases: row.aliases,
						website: row.website,
						status: row.status,
						statusBy: row.statusBy,
						seedRank: row.seedRank,
						answerRuns: row.answerRuns,
						services: row.services,
						tracked: row.tracked,
					})),
				})),
			};
		});
	});

export const addServiceFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string(), name: z.string().max(200) }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		await withSubject(data.brandId, async () => {
			await addService(data.brandId, data.name);
			await seedAndDiscover(data.brandId);
		});
	});

export const removeServiceFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string(), serviceId: z.string().uuid() }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		await withSubject(data.brandId, () => removeService(data.brandId, data.serviceId));
	});

export const findCompetitorsFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		await withSubject(data.brandId, () => seedAndDiscover(data.brandId));
	});

export const saveDiscoverySettingsFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			minRuns: z.number().int(),
			perArea: z.number().int(),
			windowDays: z.number().int(),
		}),
	)
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		const { brandId, ...settings } = data;
		await withSubject(brandId, async () => {
			await saveDiscoverySettings(brandId, settings);
			await discoverCompetitors(brandId);
		});
	});

export const setCompetitorStatusFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string(), id: z.string().uuid(), status: z.enum(["auto", "pinned", "ignored"]) }))
	.handler(async ({ data }) => {
		const session = await requireBrandSession(data.brandId);
		await withSubject(data.brandId, async () => {
			await setCompetitorStatus(data.brandId, { id: data.id, status: data.status, by: session.user.email });
			await discoverCompetitors(data.brandId);
		});
	});
