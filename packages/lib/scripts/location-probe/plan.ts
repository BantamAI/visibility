import { GRID_SUBJECT, getSubject, gridPoints, isCenter, type Point, SUBJECTS, spokePoints } from "./areas";
import { PROMPTS, type ProbePrompt, renderPrompt } from "./prompts";
import { ROUTES, type Route } from "./routes";

export type Phase = "screen" | "main" | "grid";

export interface PlannedRun {
	phase: Phase;
	route: Route;
	point: Point;
	prompt: ProbePrompt;
	rep: number;
	text: string;
}

export interface PlanOptions {
	phases: readonly Phase[];
	routes: readonly Route[];
	subjects: readonly string[];
	prompts?: readonly string[];
	/** Repeats per route; Cloro's monthly allowance is the usual reason to give a route fewer. */
	reps: (route: Route) => number;
	/** Cloro credits are scarce, so city-named prompts there are opt-in. */
	cityNamedOnCloro: boolean;
	done: ReadonlySet<string>;
}

/** Grid sensitivity: only the Google surfaces passed the screen at the point level. */
export const GRID_ROUTES = ["google-ai-mode:dataforseo", "google-ai-overview:dataforseo"];
const GRID_PROMPTS = ["N1", "N2"];
const GRID_REPS = 2;

export function runKey(run: {
	phase: Phase;
	route: { id: string };
	point: { id: string };
	prompt: { id: string };
	rep: number;
}) {
	return [run.phase, run.route.id, run.point.id, run.prompt.id, run.rep].join("|");
}

/**
 * Near-me prompts run at every point a route can take. City-named prompts carry their
 * own location, so they run once per subject, from its center. Calibration runs once per point.
 */
function asksAt(route: Route, point: Point, prompt: ProbePrompt, options: PlanOptions): boolean {
	if (route.grid === "centroid" && !isCenter(point)) return false;
	if (prompt.kind !== "city-named") return true;
	return isCenter(point) && (route.provider !== "cloro" || options.cityNamedOnCloro);
}

function mainRuns(route: Route, options: PlanOptions): Omit<PlannedRun, "text">[] {
	const reps = options.reps(route);
	return options.subjects.flatMap((subjectId) =>
		spokePoints(getSubject(subjectId)).flatMap((point) =>
			PROMPTS.filter((prompt) => asksAt(route, point, prompt, options)).flatMap((prompt) =>
				Array.from({ length: prompt.kind === "calibration" ? 1 : reps }, (_, i) => ({
					phase: "main" as const,
					route,
					point,
					prompt,
					rep: i + 1,
				})),
			),
		),
	);
}

const SCREEN_PROMPTS = ["N1", "N2", "C1"];

/**
 * A cheap first look before a route earns the full run: two near-me prompts and the
 * calibration prompt from each subject's center, plus calibration from every spoke for
 * coordinate routes. A route that clearly ignores the location stops here.
 */
function screenRuns(route: Route, options: PlanOptions): Omit<PlannedRun, "text">[] {
	return options.subjects.flatMap((subjectId) =>
		spokePoints(getSubject(subjectId)).flatMap((point) =>
			PROMPTS.filter((prompt) => SCREEN_PROMPTS.includes(prompt.id))
				.filter((prompt) => isCenter(point) || (route.grid === "coordinate" && prompt.kind === "calibration"))
				.map((prompt) => ({ phase: "screen" as const, route, point, prompt, rep: 1 })),
		),
	);
}

function gridRuns(route: Route, options: PlanOptions): Omit<PlannedRun, "text">[] {
	if (!GRID_ROUTES.includes(route.id) || !options.subjects.includes(GRID_SUBJECT)) return [];
	const prompts = PROMPTS.filter((p) => GRID_PROMPTS.includes(p.id));
	return gridPoints(getSubject(GRID_SUBJECT)).flatMap((point) =>
		prompts.flatMap((prompt) =>
			Array.from({ length: GRID_REPS }, (_, i) => ({ phase: "grid" as const, route, point, prompt, rep: i + 1 })),
		),
	);
}

export function planRuns(options: PlanOptions): PlannedRun[] {
	const runs = options.routes.flatMap((route) => [
		...(options.phases.includes("screen") ? screenRuns(route, options) : []),
		...(options.phases.includes("main") ? mainRuns(route, options) : []),
		...(options.phases.includes("grid") ? gridRuns(route, options) : []),
	]);
	return (
		runs
			.filter((run) => !options.prompts || options.prompts.includes(run.prompt.id))
			.filter((run) => !options.done.has(runKey(run)))
			.map((run) => ({ ...run, text: renderPrompt(run.prompt, getSubject(run.point.subject)) }))
			// Repeat 1 of everything before any repeat 2, so repeats are no closer in time than points are.
			.sort((a, b) => a.rep - b.rep)
	);
}

export function estimate(runs: readonly PlannedRun[]) {
	return {
		usd: runs.reduce((sum, run) => sum + run.route.estUsdPerRun, 0),
		credits: runs.reduce((sum, run) => sum + (run.route.estCredits ?? 0), 0),
	};
}

export const DEFAULT_SUBJECTS = SUBJECTS.map((s) => s.id);
export { ROUTES };
