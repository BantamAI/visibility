import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Footer } from "./footer";
import { Navbar } from "./navbar";

export function NotFound() {
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<section className="relative border-b border-zinc-200 bg-white">
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgb(0_0_0/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(0_0_0/0.04)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
					/>
					<div className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 lg:py-28">
						<div className="mx-auto max-w-2xl text-center">
							<h1 className="font-heading text-balance text-5xl leading-[1.05] tracking-tight text-zinc-950 sm:text-6xl lg:text-[4.25rem] lg:leading-[1.0]">
								This page doesn't exist
							</h1>
							<p className="mx-auto mt-6 max-w-[58ch] text-pretty text-base text-zinc-600 md:text-lg">
								The page you're looking for may have moved, or it may never have existed.
							</p>
							<div className="mt-8 flex flex-wrap items-center justify-center gap-2">
								<Link
									to="/docs"
									className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium leading-none text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:ring-zinc-300"
								>
									Read the docs
									<ArrowRight className="size-3.5" />
								</Link>
							</div>
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}
