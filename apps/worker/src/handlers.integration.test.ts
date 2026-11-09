import { randomUUID } from "node:crypto";
import { db } from "@workspace/lib/db/db";
import { brands, organization, promptRuns, prompts, runMentions } from "@workspace/lib/db/schema";
import { runOutsideTenantScope } from "@workspace/lib/db/tenant-pool";
import { REFRESH_ROLLUPS_QUEUE } from "@workspace/lib/rollups/constants";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { eq, inArray, sql } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerHandlers } from "./handlers";
import { DERIVE_RUNS_QUEUE } from "./jobs/derive-runs";

vi.mock("./mention-judge", async () => {
	const { cuedAnalyzer } = await import("./mention-judge/__fixtures__/cued-judge.js");
	return { mentionAnalyzer: () => ({ ...cuedAnalyzer, concurrency: 1 }) };
});
const sent = vi.hoisted(() => vi.fn(async () => null));
vi.mock("./boss", () => ({ getBoss: () => ({ send: sent, insert: async () => null }) }));

type Handler = (jobs: Job<unknown>[]) => Promise<unknown>;
const handlers = new Map<string, Handler>();

const owner = createOwnerDb();
const A = `brand-${randomUUID()}`;
const B = `brand-${randomUUID()}`;
const runs: Record<string, string> = {};

async function recordRun(brandId: string): Promise<string> {
	const [{ id: promptId }] = await db
		.insert(prompts)
		.values({ brandId, value: "best crm" })
		.returning({ id: prompts.id });
	const [{ id }] = await db
		.insert(promptRuns)
		.values({
			promptId,
			brandId,
			model: "gpt-5",
			provider: "openai-api",
			version: "test",
			webSearchEnabled: false,
			rawOutput: { output: [{ type: "message", content: [{ type: "output_text", text: "Acme is great." }] }] },
		})
		.returning({ id: promptRuns.id });
	return id;
}

function job<T>(data: T): Job<unknown> {
	return { id: randomUUID(), data } as Job<unknown>;
}

beforeAll(async () => {
	vi.stubEnv("DEPLOYMENT_MODE", "local");
	const boss = {
		work: async (name: string, options: unknown, handler?: Handler) => {
			handlers.set(name, handler ?? (options as Handler));
			return name;
		},
	};
	await registerHandlers(boss as unknown as PgBoss);
	for (const id of [A, B]) {
		await db.insert(organization).values({ id, name: id, slug: id, createdAt: new Date() });
		await db.insert(brands).values({ id, organizationId: id, name: "Acme", website: "https://acme.example" });
		runs[id] = await recordRun(id);
	}
});

afterAll(async () => {
	await db.delete(promptRuns).where(inArray(promptRuns.brandId, [A, B]));
	await db.delete(prompts).where(inArray(prompts.brandId, [A, B]));
	await db.delete(brands).where(inArray(brands.id, [A, B]));
	await db.delete(organization).where(inArray(organization.id, [A, B]));
	await owner.$client.end();
});

describe("registered handlers", () => {
	it("hold a brand's job to that brand's rows", async () => {
		const derive = handlers.get(DERIVE_RUNS_QUEUE);
		await runOutsideTenantScope(() => derive?.([job({ brandId: A, runIds: [runs[A], runs[B]] })]));

		const judged = await db
			.select({ runId: runMentions.runId })
			.from(runMentions)
			.where(inArray(runMentions.runId, [runs[A], runs[B]]));
		expect(judged).toEqual([{ runId: runs[A] }]);
	});

	it("give a job across brands agency access, logged once per job", async () => {
		const refresh = job({ source: "test" });
		await runOutsideTenantScope(() => handlers.get(REFRESH_ROLLUPS_QUEUE)?.([refresh]));

		const { rows } = await owner.execute<{ actor: string }>(
			sql`SELECT actor FROM agency_access_log WHERE reason = ${`pg-boss job ${refresh.id}`}`,
		);
		expect(rows).toEqual([{ actor: REFRESH_ROLLUPS_QUEUE }]);
	});

	it("skip a job whose brand can't be found", async () => {
		const gone = randomUUID();
		await expect(
			runOutsideTenantScope(() => handlers.get("process-prompt")?.([job({ promptId: gone })])),
		).resolves.toBeUndefined();
		expect(await db.select().from(promptRuns).where(eq(promptRuns.promptId, gone))).toEqual([]);
	});

	it("run no brand-mode prompt and queue no next cycle for it", async () => {
		const [prompt] = await db.select({ id: prompts.id }).from(prompts).where(eq(prompts.brandId, A));
		sent.mockClear();
		await runOutsideTenantScope(() => handlers.get("process-prompt")?.([job({ promptId: prompt.id, brandId: A })]));

		const promptRunsAfter = await db.select().from(promptRuns).where(eq(promptRuns.promptId, prompt.id));
		expect(promptRunsAfter.map((run) => run.id)).toEqual([runs[A]]);
		expect(sent).not.toHaveBeenCalled();
	});
});
