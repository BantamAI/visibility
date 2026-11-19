import type { LocalSource } from "@workspace/service/local/opportunities";
import { getCategoryLabel } from "@/components/citations/shared";

export const LOCAL_CATEGORY_META = [
	{
		key: "listings",
		label: "Listings",
		desc: "Claim, complete and correct your profile on the directories and map listings AI answers cite.",
	},
	{
		key: "reviews",
		label: "Reviews",
		desc: "Earn more genuine reviews from real customers on the platforms AI answers cite.",
	},
	{
		key: "gbp",
		label: "Google Business Profile",
		desc: "Categories, services, service area, hours and photos on the profile Google's AI answers lean on.",
	},
	{
		key: "local-press-community",
		label: "Local Press and Community",
		desc: "Local news, community sites and associations AI answers cite in your areas.",
	},
	{
		key: "service-pages",
		label: "Service Pages",
		desc: "Your own pages for each service and city you serve.",
	},
] as const;

const ROW = "block truncate rounded px-1.5 py-1 text-xs hover:bg-muted hover:text-foreground";

export function LocalSourceList({ sources }: { sources: LocalSource[] }) {
	return sources.map((source) => (
		<div key={source.domain} className="py-0.5">
			<p className="px-1.5 py-1 text-xs font-medium">
				{source.domain} <span className="font-normal text-muted-foreground">· {getCategoryLabel(source.category)}</span>
			</p>
			{source.pages.map((page) => (
				<a key={page.url} href={page.url} target="_blank" rel="noopener noreferrer" className={`${ROW} pl-4`}>
					{page.title || page.url}
				</a>
			))}
		</div>
	));
}
