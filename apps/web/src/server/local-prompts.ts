import { createServerFn } from "@tanstack/react-start";
import { parseScrapeTargets } from "@workspace/config/scrape-targets";
import { MAX_PROMPTS } from "@workspace/lib/constants";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { decidePromptCap } from "@workspace/lib/entitlements";
import { listServices } from "@workspace/service/local/competitor-discovery";
import {
	draftLocalPrompts,
	LocalPromptError,
	listAreaCities,
	MAX_JOBS_PER_SERVICE,
	setServiceJobs,
} from "@workspace/service/local/prompt-templates";
import { getRunSchedule, previewRunPlan } from "@workspace/service/local/run-planner";
import { withSubject } from "@workspace/service/local/tenancy";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireBrandSession } from "@/lib/auth/helpers";
import { createPrompts } from "@/server/prompts-core";

const draftSchema = z.object({ brandId: z.string(), cityTags: z.array(z.string()).max(200) });

/** The draft with what adding it would cost, and why it can't be added, if it can't. */
function draftWithCost(brandId: string, cityTags: readonly string[]) {
	return withSubject(brandId, async () => {
		const draft = await draftLocalPrompts(brandId, cityTags);
		const adding = draft.prompts.filter((prompt) => !prompt.exists);
		const schedule = await getRunSchedule(brandId);
		const targets = parseScrapeTargets(process.env.SCRAPE_TARGETS);
		const [before, after] = await Promise.all([
			previewRunPlan(brandId, schedule, targets),
			previewRunPlan(
				brandId,
				schedule,
				targets,
				adding.map((prompt, i) => ({ id: `draft-${i}`, tags: prompt.tags })),
			),
		]);

		let refusal: string | null = null;
		const cap = decidePromptCap(draft.existingCount, adding.length);
		if (!cap.allowed) {
			refusal = `These would take the brand to ${draft.existingCount + adding.length} prompts, over the ${MAX_PROMPTS} limit. Pick fewer cities or jobs.`;
		} else if (schedule.enabled && after.refusal) {
			refusal = `${after.refusal} Raise the budget on the Run Plan page or pick fewer cities or jobs.`;
		}

		return {
			prompts: draft.prompts,
			adding,
			existingCount: draft.existingCount,
			maxPrompts: MAX_PROMPTS,
			schedule: { enabled: schedule.enabled, monthlyBudgetUsd: schedule.monthlyBudgetUsd },
			costPerMonthUsd: { before: before.plan.costPerMonthUsd, after: after.plan.costPerMonthUsd },
			unpriced: after.plan.unpricedRunsPerMonth > 0,
			refusal,
		};
	});
}

export const getLocalPrompts = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		return withSubject(data.brandId, async () => {
			const [services, areas] = await Promise.all([listServices(data.brandId), listAreaCities(data.brandId)]);
			return {
				services: services.map(({ id, name, jobs }) => ({ id, name, jobs })),
				areas,
				maxJobs: MAX_JOBS_PER_SERVICE,
			};
		});
	});

export const setServiceJobsFn = createServerFn({ method: "POST" })
	.validator(
		z.object({ brandId: z.string(), serviceId: z.string().uuid(), jobs: z.array(z.string().max(200)).max(50) }),
	)
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		await withSubject(data.brandId, () => setServiceJobs(data.brandId, data.serviceId, data.jobs));
	});

export const previewLocalPromptsFn = createServerFn({ method: "POST" })
	.validator(draftSchema)
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		return draftWithCost(data.brandId, data.cityTags);
	});

export const addLocalPromptsFn = createServerFn({ method: "POST" })
	.validator(draftSchema)
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		const draft = await draftWithCost(data.brandId, data.cityTags);
		if (draft.refusal) throw new LocalPromptError(draft.refusal);
		if (draft.adding.length === 0) return { added: 0 };
		const brand = await db.query.brands.findFirst({ where: eq(brands.id, data.brandId) });
		if (!brand) throw new LocalPromptError("No such subject");
		const created = await createPrompts(brand, {
			prompts: draft.adding.map(({ value, tags }) => ({ value, tags })),
		});
		return { added: created.length };
	});
