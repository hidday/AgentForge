import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph of plain text", () => {
    render(<Markdown>Hello world</Markdown>);
    expect(screen.getByText("Hello world").tagName).toBe("P");
  });

  it("renders headings at the expected downsized sizes", () => {
    render(<Markdown>{"# Heading 1\n\n### Heading 3"}</Markdown>);
    const h1 = screen.getByText("Heading 1");
    expect(h1.tagName).toBe("H1");
    expect(h1.className).toContain("text-sm");

    const h3 = screen.getByText("Heading 3");
    expect(h3.tagName).toBe("H3");
    expect(h3.className).toContain("text-xs");
  });

  it("renders an unordered list with its items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    const list = screen.getByText("one").closest("ul");
    expect(list).not.toBeNull();
    expect(list?.querySelectorAll("li").length).toBe(2);
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByText("first").closest("ol");
    expect(list).not.toBeNull();
  });

  it("renders inline code with the inline style", () => {
    render(<Markdown>{"Run `npm test` now"}</Markdown>);
    const code = screen.getByText("npm test");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("px-1");
  });

  it("renders fenced code blocks with the block style", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
    expect(code.className).toContain("whitespace-pre");
  });

  it("renders links that open in a new tab safely", () => {
    render(<Markdown>{"[Anthropic](https://anthropic.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "Anthropic" });
    expect(link.getAttribute("href")).toBe("https://anthropic.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders bold and italic text", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    expect(screen.getByText("quoted text").closest("blockquote")).not.toBeNull();
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"---"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders GFM tables via remark-gfm", () => {
    const table = "| A | B |\n| - | - |\n| 1 | 2 |";
    render(<Markdown>{table}</Markdown>);
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("applies the passed className to the wrapper div", () => {
    const { container } = render(
      <Markdown className="custom-class">hi</Markdown>,
    );
    expect(container.firstElementChild?.className).toContain("custom-class");
    expect(container.firstElementChild?.className).toContain("text-text-secondary");
  });
});
