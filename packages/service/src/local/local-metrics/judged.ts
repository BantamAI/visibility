import { runMentions } from "@workspace/lib/db/schema";
import type { Sentiment } from "@workspace/lib/mentions";
import { sql } from "drizzle-orm";

/** A field of the judge's reading of the subject, when it judged the answer to mention it. */
export const judgedBrand = (field: "sentiment" | "position") =>
	sql<
		string | null
	>`CASE WHEN (${runMentions.assessments}->'brand'->>'mentioned')::boolean THEN ${runMentions.assessments}->'brand'->>${field} END`;

const SENTIMENTS = new Set<string>(["positive", "neutral", "negative", "mixed"]);

export const judgedSentiment = (value: string | null): Sentiment | null =>
	value !== null && SENTIMENTS.has(value) ? (value as Sentiment) : null;

/** A matched card's position, else where the judge ranks the subject among the tracked businesses named. */
export function subjectPosition(
	cardPosition: number | null,
	judgedPosition: string | null,
): { position: number | null; positionFrom: "card" | "text" | null } {
	if (cardPosition !== null) return { position: cardPosition, positionFrom: "card" };
	const text = judgedPosition === null ? Number.NaN : Number(judgedPosition);
	return Number.isInteger(text) ? { position: text, positionFrom: "text" } : { position: null, positionFrom: null };
}
