import { Link } from "@tanstack/react-router";
import { Logo } from "./logo";

export function Navbar() {
	return (
		<header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur">
			<div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-6">
				<Link to="/docs" className="flex items-center">
					<Logo className="text-2xl" />
				</Link>
				<Link to="/docs" className="text-sm font-medium text-zinc-600 hover:text-zinc-950">
					Docs
				</Link>
			</div>
		</header>
	);
}
