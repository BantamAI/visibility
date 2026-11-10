import { IconCoin, IconNews, IconReport, IconTable, IconTimeline, IconTool } from "@tabler/icons-react";
import type { NavItem } from "@/components/nav-main";

export function adminNavItems({
	isAdmin,
	hasReportAccess,
	reportsEnabled,
}: {
	isAdmin: boolean;
	hasReportAccess: boolean;
	reportsEnabled: boolean;
}): NavItem[] {
	const reports: NavItem = { title: "Reports", link: { to: "/reports" }, icon: IconReport };

	if (!isAdmin) return hasReportAccess && reportsEnabled ? [reports] : [];

	return [
		{ title: "Brands", link: { to: "/admin" }, icon: IconTable },
		...(reportsEnabled ? [reports] : []),
		{ title: "Workflows", link: { to: "/admin/workflows" }, icon: IconTimeline },
		{ title: "Vendor Spend", link: { to: "/admin/vendor-spend" }, icon: IconCoin },
		{ title: "Local News", link: { to: "/admin/local-news" }, icon: IconNews },
		{ title: "Tools", link: { to: "/admin/tools" }, icon: IconTool },
	];
}
