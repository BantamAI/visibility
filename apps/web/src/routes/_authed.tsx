/**
 * Auth layout route - pathless layout that protects all child routes.
 *
 * Checks for an authenticated better-auth session, redirects to /auth/login if not found.
 * Owns the app shell for every signed-in page that has one, so the rail and
 * header survive a move between a brand, its organization, and the admin
 * section instead of being rebuilt by whichever layout was entered. Layouts
 * declare which shell they live in through `staticData.shell`; see
 * lib/shell-scope.ts.
 */

import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell, PageContent } from "@/components/app-shell";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { useShellScope } from "@/hooks/use-shell-scope";
import { attributionParams } from "@/lib/attribution";
import { viewerQuery } from "@/lib/viewer/queries";

export const Route = createFileRoute("/_authed")({
	beforeLoad: async ({ context, location }) => {
		const viewer = await context.queryClient.ensureQueryData({ ...viewerQuery, revalidateIfStale: true });

		if (!viewer) {
			context.queryClient.removeQueries({ queryKey: viewerQuery.queryKey });
			throw redirect({
				to: "/auth/login",
				search: { returnTo: location.href, ...attributionParams(location.search) },
			});
		}

		return viewer;
	},
	component: AuthedLayout,
});

function AuthedLayout() {
	return <Shell />;
}

function Shell() {
	const scope = useShellScope();

	if (!scope) return <Outlet />;

	return (
		<AppShell sidebar={<AppSidebar {...scope} />} header={<SiteHeader />}>
			{scope.section === "account" ? (
				<div className="flex flex-1 flex-col">
					<Outlet />
				</div>
			) : (
				<PageContent>
					<Outlet />
				</PageContent>
			)}
		</AppShell>
	);
}
