import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a heading", () => {
    render(<Markdown>{"# Hello"}</Markdown>);
    const heading = screen.getByRole("heading", { level: 1, name: "Hello" });
    expect(heading.tagName).toBe("H1");
  });

  it("renders bold and italic text", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const bold = screen.getByText("bold");
    expect(bold.tagName).toBe("STRONG");
    expect(bold.className).toContain("font-semibold");

    const italic = screen.getByText("italic");
    expect(italic.tagName).toBe("EM");
    expect(italic.className).toContain("italic");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("one");
    expect(items[1].textContent).toBe("two");
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
  });

  it("renders a link that opens in a new tab with safe rel attributes", () => {
    render(<Markdown>{"[click me](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click me" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders an inline code span without the block styling class", () => {
    render(<Markdown>{"use `inline()` here"}</Markdown>);
    const code = screen.getByText("inline()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
    expect(code.className).toContain("px-1");
  });

  it("renders a fenced code block with the block styling class, wrapped in <pre>", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
    expect(code.className).toContain("whitespace-pre");
    expect(code.closest("pre")).not.toBeNull();
  });

  it("renders a GFM table (remark-gfm) with th/td cells", () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    render(<Markdown>{table}</Markdown>);
    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("renders a blockquote and a horizontal rule", () => {
    render(<Markdown>{"> quoted text\n\n---"}</Markdown>);
    const quote = screen.getByText("quoted text");
    expect(quote.closest("blockquote")).not.toBeNull();
    expect(document.querySelector("hr")).not.toBeNull();
  });

  it("applies the custom className alongside the base text-text-secondary class", () => {
    const { container } = render(
      <Markdown className="custom-class">{"plain text"}</Markdown>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("text-text-secondary");
    expect(wrapper.className).toContain("custom-class");
  });

  it("renders h2, h3, and h4 headings with their respective tag names", () => {
    render(<Markdown>{"## Two\n\n### Three\n\n#### Four"}</Markdown>);
    expect(screen.getByRole("heading", { level: 2, name: "Two" }).tagName).toBe("H2");
    expect(screen.getByRole("heading", { level: 3, name: "Three" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { level: 4, name: "Four" }).tagName).toBe("H4");
  });

  it("renders multiple paragraphs", () => {
    render(<Markdown>{"first paragraph\n\nsecond paragraph"}</Markdown>);
    expect(screen.getByText("first paragraph").tagName).toBe("P");
    expect(screen.getByText("second paragraph").tagName).toBe("P");
  });
});
