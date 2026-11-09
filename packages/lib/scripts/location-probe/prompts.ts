import type { Subject } from "./areas";

export type PromptKind = "near-me" | "city-named" | "calibration";

export interface ProbePrompt {
	id: string;
	intent: string;
	kind: PromptKind;
	text: string;
}

/**
 * Five intents, each asked "near me" (the location must come from the run) and
 * with the city named (the floor any route reaches). The calibration prompt shows
 * whether a location reached the engine at all.
 */
export const PROMPTS: readonly ProbePrompt[] = [
	{ id: "N1", intent: "emergency", kind: "near-me", text: "I have a burst pipe, who's an emergency plumber near me?" },
	{ id: "N2", intent: "reputation", kind: "near-me", text: "who are the best-reviewed plumbers near me?" },
	{ id: "N3", intent: "replacement", kind: "near-me", text: "which plumbers near me install tankless water heaters?" },
	{ id: "N4", intent: "price", kind: "near-me", text: "affordable plumber near me to fix a leaking toilet" },
	{ id: "N5", intent: "specialist", kind: "near-me", text: "plumbing company near me that does sewer line repair" },
	{
		id: "T1",
		intent: "emergency",
		kind: "city-named",
		text: "I have a burst pipe, who's an emergency plumber in {city}?",
	},
	{ id: "T2", intent: "reputation", kind: "city-named", text: "who are the best-reviewed plumbers in {city}?" },
	{
		id: "T3",
		intent: "replacement",
		kind: "city-named",
		text: "which plumbers in {city} install tankless water heaters?",
	},
	{ id: "T4", intent: "price", kind: "city-named", text: "affordable plumber in {city} to fix a leaking toilet" },
	{
		id: "T5",
		intent: "specialist",
		kind: "city-named",
		text: "plumbing company in {city} that does sewer line repair",
	},
	{ id: "C1", intent: "calibration", kind: "calibration", text: "what city am I in right now?" },
];

export function renderPrompt(prompt: ProbePrompt, subject: Subject): string {
	return prompt.text.replaceAll("{city}", `${subject.city}, ${subject.region}`);
}

export function getPrompt(id: string): ProbePrompt {
	const prompt = PROMPTS.find((candidate) => candidate.id === id);
	if (!prompt) throw new Error(`Unknown prompt "${id}"`);
	return prompt;
}

export const promptsOfKind = (kind: PromptKind) => PROMPTS.filter((prompt) => prompt.kind === kind);
