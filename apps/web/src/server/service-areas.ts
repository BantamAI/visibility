import { createServerFn } from "@tanstack/react-start";
import {
	deleteServiceArea,
	listServiceAreas,
	MAX_GRID_SIZE,
	MIN_GRID_SIZE,
	saveServiceArea,
} from "@workspace/service/local/service-areas";
import { withSubject } from "@workspace/service/local/tenancy";
import { z } from "zod";
import { requireBrandSession } from "@/lib/auth/helpers";

export const getServiceAreas = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		return withSubject(data.brandId, () => listServiceAreas(data.brandId));
	});

export const saveServiceAreaFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			areaId: z.string().uuid().optional(),
			area: z.object({
				name: z.string(),
				centerLat: z.number(),
				centerLng: z.number(),
				radiusMeters: z.number(),
				timezone: z.string(),
				gridSize: z.number().int().min(MIN_GRID_SIZE).max(MAX_GRID_SIZE),
				isPrimary: z.boolean(),
				polygon: z.unknown().optional(),
			}),
		}),
	)
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		await withSubject(data.brandId, () => saveServiceArea(data.brandId, data.area, data.areaId));
	});

export const deleteServiceAreaFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string(), areaId: z.string().uuid() }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		await withSubject(data.brandId, () => deleteServiceArea(data.brandId, data.areaId));
	});
