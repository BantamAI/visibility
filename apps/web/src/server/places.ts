import { createServerFn } from "@tanstack/react-start";
import { confirmAnchor, findPlaces, listAnchorTargets, removeAnchor } from "@workspace/service/local/places";
import { listServiceAreas } from "@workspace/service/local/service-areas";
import { withSubject } from "@workspace/service/local/tenancy";
import { configuredPlacesProvider } from "@workspace/service/providers/places";
import { z } from "zod";
import { requireBrandSession } from "@/lib/auth/helpers";

export const getPlaceAnchors = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		return withSubject(data.brandId, async () => {
			const [targets, areas] = await Promise.all([listAnchorTargets(data.brandId), listServiceAreas(data.brandId)]);
			return {
				configured: Boolean(process.env.GOOGLE_PLACES_API_KEY),
				targets: targets.map(({ competitorName, name, anchor }) => ({
					competitorName,
					name,
					anchor: anchor && {
						placeId: anchor.placeId,
						cid: anchor.cid,
						searchQuery: anchor.searchQuery,
						confirmedBy: anchor.confirmedBy,
						confirmedAt: anchor.confirmedAt.toISOString(),
						checkedAt: anchor.checkedAt.toISOString(),
						obsoleteAt: anchor.obsoleteAt?.toISOString() ?? null,
					},
				})),
				areas: areas.map((area) => ({ id: area.id, name: area.name, isPrimary: area.isPrimary })),
			};
		});
	});

export const searchPlacesFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string(), query: z.string().max(200), areaId: z.string().uuid().optional() }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		const provider = configuredPlacesProvider();
		return withSubject(data.brandId, () =>
			findPlaces(provider, data.brandId, { query: data.query, areaId: data.areaId }),
		);
	});

export const confirmPlaceAnchorFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			competitorName: z.string().nullable(),
			placeId: z.string().max(400),
			cid: z.string().nullable(),
			searchQuery: z.string().max(200),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireBrandSession(data.brandId);
		await withSubject(data.brandId, () =>
			confirmAnchor(data.brandId, {
				competitorName: data.competitorName,
				placeId: data.placeId,
				cid: data.cid,
				searchQuery: data.searchQuery,
				confirmedBy: session.user.email,
			}),
		);
	});

export const removePlaceAnchorFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string(), competitorName: z.string().nullable() }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		await withSubject(data.brandId, () => removeAnchor(data.brandId, data.competitorName));
	});
