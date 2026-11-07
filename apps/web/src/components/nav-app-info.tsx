import { useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";

export function NavAppInfo() {
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };

	if (context.clientConfig?.mode === "whitelabel") return null;

	return (
		<div className="mx-2 mt-1 flex items-center gap-2 border-t border-sidebar-border/60 px-1 pt-2">
			<span className="flex-1 text-xs font-medium text-muted-foreground">v{__APP_VERSION__}</span>
		</div>
	);
}
