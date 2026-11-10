import { createServerFn } from "@tanstack/react-start";
import {
	addLocalNewsSource,
	installLocalCitationCategories,
	listLocalNewsSources,
	removeLocalNewsSource,
} from "@workspace/service/local/citation-categories";
import { z } from "zod";
import { isAdmin, requireAuthSession } from "@/lib/auth/helpers";

async function requireAdmin() {
	const session = await requireAuthSession();
	if (!isAdmin(session)) throw new Error("Unauthorized: Admin access required");
	return session;
}

export const getLocalNewsSourcesFn = createServerFn({ method: "GET" }).handler(async () => {
	await requireAdmin();
	const metros = await listLocalNewsSources();
	return metros.map((metro) => ({
		...metro,
		sources: metro.sources.map((source) => ({ ...source, createdAt: source.createdAt.toISOString() })),
	}));
});

export const addLocalNewsSourceFn = createServerFn({ method: "POST" })
	.validator(z.object({ metro: z.string(), domain: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAdmin();
		installLocalCitationCategories();
		await addLocalNewsSource(data.metro, data.domain, session.user.email);
	});

export const removeLocalNewsSourceFn = createServerFn({ method: "POST" })
	.validator(z.object({ id: z.string().uuid() }))
	.handler(async ({ data }) => {
		await requireAdmin();
		installLocalCitationCategories();
		await removeLocalNewsSource(data.id);
	});
