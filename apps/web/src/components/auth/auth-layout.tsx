import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

interface AuthLayoutProps {
	title: string;
	subtitle?: string;
	children: ReactNode;
}

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
	return (
		<div className="flex min-h-svh items-center justify-center px-6 py-12 sm:px-10">
			<div className="flex w-full max-w-sm flex-col">
				<Logo />
				<div className="py-10">
					<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
					{subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
					<div className="mt-8">{children}</div>
				</div>
			</div>
		</div>
	);
}
