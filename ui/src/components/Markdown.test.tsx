import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

function md(src: string, className?: string) {
  return render(<Markdown className={className}>{src}</Markdown>).container;
}

describe("Markdown", () => {
  it("wraps output with base and custom classes", () => {
    const c = md("hello", "custom");
    const root = c.firstElementChild!;
    expect(root.className).toContain("text-text-secondary");
    expect(root.className).toContain("custom");
    expect(root.querySelector("p")!.textContent).toBe("hello");
  });

  it("renders lists, emphasis and headings with custom components", () => {
    const c = md(
      "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n- a\n- **bold**\n\n1. one\n2. *it*\n\n> quote\n\n---\n",
    );
    expect(c.querySelector("h1")!.textContent).toBe("H1");
    expect(c.querySelector("h2")!.textContent).toBe("H2");
    expect(c.querySelector("h3")!.textContent).toBe("H3");
    expect(c.querySelector("h4")!.textContent).toBe("H4");
    expect(c.querySelector("ul")!.className).toContain("list-disc");
    expect(c.querySelectorAll("ul li")).toHaveLength(2);
    expect(c.querySelector("ol")!.className).toContain("list-decimal");
    expect(c.querySelector("strong")!.textContent).toBe("bold");
    expect(c.querySelector("em")!.textContent).toBe("it");
    expect(c.querySelector("blockquote")!.textContent).toContain("quote");
    expect(c.querySelector("hr")).not.toBeNull();
  });

  it("distinguishes inline code from fenced code blocks", () => {
    const c = md("use `foo()` here\n\n```ts\nconst x = 1;\n```\n");
    const codes = c.querySelectorAll("code");
    expect(codes).toHaveLength(2);
    expect(codes[0]!.className).not.toContain("block");
    expect(codes[0]!.textContent).toBe("foo()");
    expect(codes[1]!.className).toContain("block");
    expect(codes[1]!.closest("pre")).not.toBeNull();
  });

  it("opens links in a new tab safely", () => {
    const c = md("[site](https://example.com)");
    const a = c.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.com");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders GFM tables inside a scroll wrapper", () => {
    const c = md("| A | B |\n|---|---|\n| 1 | 2 |\n");
    const table = c.querySelector("table")!;
    expect(table.parentElement!.className).toContain("overflow-x-auto");
    expect(Array.from(c.querySelectorAll("th")).map((t) => t.textContent)).toEqual(["A", "B"]);
    expect(Array.from(c.querySelectorAll("td")).map((t) => t.textContent)).toEqual(["1", "2"]);
  });
});
