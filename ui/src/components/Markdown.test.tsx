import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain paragraph text", () => {
    render(<Markdown>{"Just plain text."}</Markdown>);
    expect(screen.getByText("Just plain text.")).toBeDefined();
  });

  it("renders an empty string without throwing", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.querySelector("div")).toBeDefined();
  });

  it("renders headings h1-h4", () => {
    render(<Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>);
    expect(screen.getByRole("heading", { level: 1, name: "H1" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "H2" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 3, name: "H3" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 4, name: "H4" })).toBeDefined();
  });

  it("renders unordered and ordered lists with list items", () => {
    render(<Markdown>{"- one\n- two\n\n1. first\n2. second"}</Markdown>);
    expect(screen.getByText("one")).toBeDefined();
    expect(screen.getByText("two")).toBeDefined();
    expect(screen.getByText("first")).toBeDefined();
    const lists = screen.getAllByRole("list");
    expect(lists.length).toBe(2);
  });

  it("renders bold and italic emphasis", () => {
    render(<Markdown>{"**bold text** and *italic text*"}</Markdown>);
    expect(screen.getByText("bold text").tagName).toBe("STRONG");
    expect(screen.getByText("italic text").tagName).toBe("EM");
  });

  it("renders inline code without the block style and fenced code blocks with the block style", () => {
    render(<Markdown>{"Use `inline()` here.\n\n```js\nblock code\n```"}</Markdown>);
    const inline = screen.getByText("inline()");
    expect(inline.tagName).toBe("CODE");
    expect(inline.className).not.toContain("block ");

    const block = screen.getByText("block code");
    expect(block.tagName).toBe("CODE");
    expect(block.className).toContain("block ");
  });

  it("renders links with target=_blank and rel attributes", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders blockquotes and horizontal rules", () => {
    const { container } = render(<Markdown>{"> quoted text\n\n---\n\nafter"}</Markdown>);
    expect(screen.getByText("quoted text").closest("blockquote")).toBeDefined();
    expect(container.querySelector("hr")).toBeDefined();
  });

  it("renders GFM tables via remark-gfm with th/td cells", () => {
    const table = "| A | B |\n| - | - |\n| 1 | 2 |";
    render(<Markdown>{table}</Markdown>);
    expect(screen.getByRole("columnheader", { name: "A" })).toBeDefined();
    expect(screen.getByRole("cell", { name: "1" })).toBeDefined();
  });

  it("forwards a custom className to the wrapping div", () => {
    const { container } = render(<Markdown className="custom-class">{"text"}</Markdown>);
    expect(container.querySelector("div.custom-class")).toBeDefined();
  });
});
