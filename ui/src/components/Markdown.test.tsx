import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders paragraph text", () => {
    render(<Markdown>Hello world</Markdown>);
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("renders bold text with strong styling", () => {
    render(<Markdown>**bold text**</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-semibold");
  });

  it("renders italic text with em styling", () => {
    render(<Markdown>*italic text*</Markdown>);
    const em = screen.getByText("italic text");
    expect(em.tagName).toBe("EM");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one").tagName).toBe("LI");
    expect(screen.getByText("two").tagName).toBe("LI");
    expect(screen.getByText("one").closest("ul")).not.toBeNull();
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    expect(screen.getByText("first").closest("ol")).not.toBeNull();
  });

  it("renders inline code with inline styling (no language- class)", () => {
    render(<Markdown>{"`inline()`"}</Markdown>);
    const code = screen.getByText("inline()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("px-1");
  });

  it("renders fenced code blocks with block styling", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
  });

  it("renders a link that opens in a new tab", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByText("click here");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("renders headings", () => {
    render(<Markdown>{"# Heading One"}</Markdown>);
    const h1 = screen.getByText("Heading One");
    expect(h1.tagName).toBe("H1");
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    const quote = screen.getByText("quoted text");
    expect(quote.closest("blockquote")).not.toBeNull();
  });

  it("renders a GFM table with th/td cells (remark-gfm enabled)", () => {
    render(
      <Markdown>
        {"| A | B |\n| --- | --- |\n| 1 | 2 |"}
      </Markdown>,
    );
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("applies an optional className to the wrapper", () => {
    const { container } = render(
      <Markdown className="extra-class">text</Markdown>,
    );
    expect(container.firstElementChild?.className).toContain("extra-class");
  });
});
