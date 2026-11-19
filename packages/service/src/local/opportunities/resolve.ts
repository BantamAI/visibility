import { db } from "@workspace/lib/db/db";
import { brandOpportunities, usageEvents } from "@workspace/lib/db/schema";
import { runStructuredCompletionPrompt } from "@workspace/lib/onboarding";
import type { StructuredResearchResult } from "@workspace/lib/providers";
import { and, desc, eq, sql } from "drizzle-orm";
import { withSubject } from "../tenancy";
import { buildLocalDigest } from "./digest";
import { loadDigestInput, serviceAreas } from "./load";
import {
	groundReport,
	type LocalOpportunitiesReport,
	localOpportunitiesSchema,
	playbookPrompt,
	type RawLocalReport,
	type SubjectFacts,
} from "./playbook";

export const PLAYBOOK_USAGE_EVENT = "local_opportunities";

/** Elmo's page says "Refreshed weekly", so this matches its gate. */
const REFRESH_AFTER_DAYS = 6;
const WINDOW_DAYS = 30;
const MAX_GENERATION_ATTEMPTS = 3;
const DAY_MS = 86_400_000;

export interface LocalOpportunitiesResponse {
	report: LocalOpportunitiesReport | null;
	reason: "insufficient-data" | null;
	generatedFor: { brandName: string } | null;
	lastEvaluatedAt: string | null;
	model: string | null;
}

export type GeneratePlaybook = (
	prompt: string,
	schema: typeof localOpportunitiesSchema,
) => Promise<StructuredResearchResult<RawLocalReport>>;

export interface PlaybookOptions {
	generate?: GeneratePlaybook;
	/** The facts API client; until a subject's facts come from it, the playbook gives no on-page advice. */
	loadFacts?: (subjectId: string) => Promise<SubjectFacts | null>;
	now?: Date;
}

const noFacts = async () => null;

function playbookWindow(now: Date) {
	const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS);
	return { since: new Date(until.getTime() - WINDOW_DAYS * DAY_MS), until, days: WINDOW_DAYS };
}

async function latestPlaybook(subjectId: string) {
	const [latest] = await db
		.select()
		.from(brandOpportunities)
		.where(and(eq(brandOpportunities.brandId, subjectId), sql`${brandOpportunities.report}->>'variant' = 'local'`))
		.orderBy(desc(brandOpportunities.createdAt))
		.limit(1);
	return latest;
}

/** Every attempt is a billed call, so each counts toward usage, valid or not. */
async function generateValid(generate: GeneratePlaybook, prompt: string) {
	let model: string | null = null;
	for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
		try {
			const result = await generate(prompt, localOpportunitiesSchema);
			model = result.modelVersion ?? model;
			const parsed = localOpportunitiesSchema.safeParse(result.object);
			if (parsed.success) return { raw: parsed.data, model, attempts: attempt };
			console.warn(`[local-opportunities] schema mismatch (attempt ${attempt}/${MAX_GENERATION_ATTEMPTS})`);
		} catch (error) {
			console.warn(`[local-opportunities] generation error (attempt ${attempt}/${MAX_GENERATION_ATTEMPTS}):`, error);
		}
	}
	return { raw: null, model, attempts: MAX_GENERATION_ATTEMPTS };
}

async function recordGeneration(subjectId: string, organizationId: string, model: string | null, calls: number) {
	try {
		await db
			.insert(usageEvents)
			.values({ organizationId, brandId: subjectId, eventType: PLAYBOOK_USAGE_EVENT, model, units: calls });
	} catch (error) {
		console.error("[local-opportunities] Couldn't record a playbook's usage:", error);
	}
}

/**
 * The local opportunity playbook for a subject with a service area, generated inline when the stored
 * one is stale, like Elmo's report; null for a subject with no service area, which keeps Elmo's.
 */
export function resolveLocalOpportunities(
	subjectId: string,
	options: PlaybookOptions = {},
): Promise<LocalOpportunitiesResponse | null> {
	const { generate = runStructuredCompletionPrompt, loadFacts = noFacts, now = new Date() } = options;
	return withSubject(subjectId, async () => {
		if ((await serviceAreas(subjectId)).length === 0) return null;

		const latest = await latestPlaybook(subjectId);
		const stored = (): LocalOpportunitiesResponse | null =>
			latest
				? {
						report: latest.report as LocalOpportunitiesReport,
						reason: null,
						generatedFor: null,
						lastEvaluatedAt: latest.createdAt.toISOString(),
						model: latest.model,
					}
				: null;
		if (latest && now.getTime() - latest.createdAt.getTime() < REFRESH_AFTER_DAYS * DAY_MS) return stored();

		const input = await loadDigestInput(subjectId, playbookWindow(now));
		const digest = buildLocalDigest(input);
		if (!digest)
			return (
				stored() ?? {
					report: null,
					reason: "insufficient-data",
					generatedFor: null,
					lastEvaluatedAt: null,
					model: null,
				}
			);

		const facts = await loadFacts(subjectId);
		const generated = await generateValid(generate, playbookPrompt(digest.text, facts));
		await recordGeneration(subjectId, input.organizationId, generated.model, generated.attempts);
		if (!generated.raw) {
			const fallback = stored();
			if (fallback) return fallback;
			throw new Error("Failed to generate a valid local opportunities report");
		}

		const report = groundReport(generated.raw, digest.index, facts);
		const [saved] = await db
			.insert(brandOpportunities)
			.values({ brandId: subjectId, report, model: generated.model, createdAt: now })
			.returning({ createdAt: brandOpportunities.createdAt });
		return {
			report,
			reason: null,
			generatedFor: { brandName: input.subject.name },
			lastEvaluatedAt: saved?.createdAt.toISOString() ?? null,
			model: generated.model,
		};
	});
}
