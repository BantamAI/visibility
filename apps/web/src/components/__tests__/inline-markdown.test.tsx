import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlineMarkdown } from "@/components/response-markdown";

const render = (markdown: string) => renderToStaticMarkup(<InlineMarkdown>{markdown}</InlineMarkdown>);

describe("InlineMarkdown", () => {
	it("flattens lists, headings and paragraphs into one run of text", () => {
		const html = render(
			"### Best options\n\n1. **ChatSpy** is open source.\n2. Peec is hosted.\n\nBoth track citations.",
		);
		expect(html.replace(/\s+/g, " ").trim()).toBe(
			"<strong>Best options</strong> — <strong>ChatSpy</strong> is open source. Peec is hosted. Both track citations.",
		);
	});

	it("keeps emphasis and links", () => {
		const html = render("*Really* **good**, see [docs](https://chatspy.example.com).");
		expect(html).toContain("<em>Really</em>");
		expect(html).toContain("<strong>good</strong>");
		expect(html).toContain('href="https://chatspy.example.com"');
	});

	it("drops images rather than showing broken icons inline", () => {
		expect(render("![logo](https://example.com/a.png) Ahrefs")).not.toContain("<img");
	});

	it("reads an indented passage as text, not code", () => {
		const html = render("    **▫ ChatSpy** — closest complete replacement\n    **▫ GetCito** — most ambitious");
		expect(html).not.toContain("<code>");
		expect(html).toContain("<strong>▫ ChatSpy</strong>");
	});
});
