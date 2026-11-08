/**
 * Authentication middleware for TanStack Start
 *
 * Provides user session and deployment context to server functions.
 *
 * Access-control decisions are delegated to pure policy functions
 * in `@/lib/auth/policies` so they can be tested independently.
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getDeployment } from "@workspace/deployment";
import { withAgency } from "@workspace/service/local/tenancy";
import { auth } from "@/lib/auth/server";

/**
 * Auth middleware - provides deployment context to all server functions.
 * Does NOT enforce authentication; server functions check `session` themselves.
 *
 * Everyone who signs in is agency staff, so a signed-in call runs with agency
 * access, logged once per call. Without a session it reaches no subject rows.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next, serverFnMeta }) => {
	const deployment = getDeployment();
	const headers = getRequestHeaders();
	const session = await auth.api.getSession({ headers });
	const proceed = () =>
		next({
			context: {
				session,
				deployment,
			},
		});

	if (!session) return proceed();
	// Server functions called during SSR carry only their id.
	const name = serverFnMeta.name || serverFnMeta.id;
	return withAgency({ actor: session.user.email, reason: `server function ${name}` }, proceed);
});
