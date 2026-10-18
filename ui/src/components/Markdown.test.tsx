import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a heading with the custom heading styling", () => {
    render(<Markdown>{"# Big Title"}</Markdown>);
    const heading = screen.getByText("Big Title");
    expect(heading.tagName).toBe("H1");
    expect(heading.className).toContain("font-semibold");
  });

  it("renders h2-h4 headings", () => {
    render(
      <Markdown>{"## H2\n\n### H3\n\n#### H4"}</Markdown>,
    );
    expect(screen.getByText("H2").tagName).toBe("H2");
    expect(screen.getByText("H3").tagName).toBe("H3");
    expect(screen.getByText("H4").tagName).toBe("H4");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- one\n- two\n- three"}</Markdown>);
    const list = screen.getByText("one").closest("ul");
    expect(list).not.toBeNull();
    expect(screen.getByText("two")).toBeDefined();
    expect(screen.getByText("three")).toBeDefined();
    expect(list?.querySelectorAll("li").length).toBe(3);
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByText("first").closest("ol");
    expect(list).not.toBeNull();
    expect(list?.querySelectorAll("li").length).toBe(2);
  });

  it("renders bold and italic text", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const bold = screen.getByText("bold");
    expect(bold.tagName).toBe("STRONG");
    const italic = screen.getByText("italic");
    expect(italic.tagName).toBe("EM");
  });

  it("renders an inline code span with inline styling", () => {
    render(<Markdown>{"Use `const x = 1` here"}</Markdown>);
    const code = screen.getByText("const x = 1");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("rounded");
    expect(code.className).not.toContain("block");
  });

  it("renders a fenced code block with block styling inside a pre", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
    expect(code.closest("pre")).not.toBeNull();
  });

  it("renders a link that opens in a new tab with safe rel attributes", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByText("click here");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    const quote = screen.getByText("quoted text");
    expect(quote.closest("blockquote")).not.toBeNull();
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders GFM tables via remark-gfm", () => {
    const table = "| A | B |\n| - | - |\n| 1 | 2 |";
    render(<Markdown>{table}</Markdown>);
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("does not render raw HTML tags as actual DOM elements (no rehype-raw)", () => {
    const { container } = render(
      <Markdown>{"<div data-testid='injected'>raw html</div>"}</Markdown>,
    );
    // Without rehype-raw, react-markdown escapes raw HTML as literal text
    // rather than creating a real element.
    expect(container.querySelector("[data-testid='injected']")).toBeNull();
  });

  it("does not execute or render a raw script tag as an actual script element", () => {
    const { container } = render(
      <Markdown>{"<script>window.__pwned = true;</script>"}</Markdown>,
    );
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("applies the passed className to the wrapping div", () => {
    const { container } = render(
      <Markdown className="my-extra-class">{"hello"}</Markdown>,
    );
    expect(container.firstElementChild?.className).toContain("my-extra-class");
  });

  it("renders plain paragraph text with paragraph spacing styling", () => {
    render(<Markdown>{"Just a plain paragraph."}</Markdown>);
    const p = screen.getByText("Just a plain paragraph.");
    expect(p.tagName).toBe("P");
    expect(p.className).toContain("mb-2");
  });
});
