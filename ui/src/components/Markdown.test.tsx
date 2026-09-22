import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders an empty string without crashing and produces no visible content", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    // Only the wrapping div should exist, with no rendered markdown children.
    expect(container.querySelector("div")?.children.length).toBe(0);
  });

  it("renders a paragraph", () => {
    render(<Markdown>{"Hello world"}</Markdown>);
    const p = screen.getByText("Hello world");
    expect(p.tagName).toBe("P");
    expect(p.className).toContain("mb-2");
  });

  it("renders headings h1-h4 with the expected tag and styling", () => {
    render(<Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>);
    const h1 = screen.getByText("H1");
    const h2 = screen.getByText("H2");
    const h3 = screen.getByText("H3");
    const h4 = screen.getByText("H4");
    expect(h1.tagName).toBe("H1");
    expect(h2.tagName).toBe("H2");
    expect(h3.tagName).toBe("H3");
    expect(h4.tagName).toBe("H4");
    expect(h1.className).toContain("font-semibold");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- item one\n- item two"}</Markdown>);
    const list = screen.getByText("item one").closest("ul");
    expect(list).not.toBeNull();
    expect(list?.className).toContain("list-disc");
    expect(screen.getByText("item two").tagName).toBe("LI");
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByText("first").closest("ol");
    expect(list).not.toBeNull();
    expect(list?.className).toContain("list-decimal");
  });

  it("renders inline code without the block styling class", () => {
    render(<Markdown>{"Use `npm test` here"}</Markdown>);
    const code = screen.getByText("npm test");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders a fenced code block with the block styling class", () => {
    const { container } = render(
      <Markdown>{"```js\nconst a = 1;\n```"}</Markdown>,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.className).toContain("block");
    expect(code?.textContent).toBe("const a = 1;\n");
  });

  it("renders a link with target=_blank and rel=noreferrer noopener", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByText("click here");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders bold and italic text with the expected tags", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const strong = screen.getByText("bold");
    const em = screen.getByText("italic");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-semibold");
    expect(em.tagName).toBe("EM");
    expect(em.className).toContain("italic");
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> a quote"}</Markdown>);
    const quote = screen.getByText("a quote").closest("blockquote");
    expect(quote).not.toBeNull();
    expect(quote?.className).toContain("border-l-2");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"before\n\n---\n\nafter"}</Markdown>);
    const hr = container.querySelector("hr");
    expect(hr).not.toBeNull();
    expect(hr?.className).toContain("border-border-subtle");
  });

  it("renders a GFM table with th/td cells", () => {
    render(
      <Markdown>{"| A | B |\n| - | - |\n| 1 | 2 |"}</Markdown>,
    );
    const th = screen.getByText("A");
    const td = screen.getByText("1");
    expect(th.tagName).toBe("TH");
    expect(td.tagName).toBe("TD");
    expect(th.className).toContain("border");
    expect(td.className).toContain("align-top");
  });

  it("applies an additional className to the wrapping div", () => {
    const { container } = render(
      <Markdown className="custom-class">{"text"}</Markdown>,
    );
    expect(container.querySelector("div")?.className).toContain("custom-class");
    expect(container.querySelector("div")?.className).toContain("text-text-secondary");
  });
});
