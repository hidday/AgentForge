import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph", () => {
    render(<Markdown>{"Hello world"}</Markdown>);
    expect(screen.getByText("Hello world").tagName).toBe("P");
  });

  it("renders an unordered list", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one").closest("ul")).not.toBeNull();
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. one\n2. two"}</Markdown>);
    expect(screen.getByText("one").closest("ol")).not.toBeNull();
  });

  it("renders list items", () => {
    render(<Markdown>{"- item"}</Markdown>);
    expect(screen.getByText("item").tagName).toBe("LI");
  });

  it("renders bold text as strong", () => {
    render(<Markdown>{"**bold text**"}</Markdown>);
    const el = screen.getByText("bold text");
    expect(el.tagName).toBe("STRONG");
    expect(el.className).toContain("font-semibold");
  });

  it("renders italic text as em", () => {
    render(<Markdown>{"*italic text*"}</Markdown>);
    expect(screen.getByText("italic text").tagName).toBe("EM");
  });

  it("renders inline code without the block styling", () => {
    render(<Markdown>{"`inline`"}</Markdown>);
    const el = screen.getByText("inline");
    expect(el.tagName).toBe("CODE");
    expect(el.className).not.toContain("block");
  });

  it("renders a fenced code block with block styling, wrapped in pre", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const el = screen.getByText("const x = 1;");
    expect(el.tagName).toBe("CODE");
    expect(el.className).toContain("block");
    expect(el.closest("pre")).not.toBeNull();
  });

  it("renders a link with target=_blank and rel=noreferrer noopener", () => {
    render(<Markdown>{"[click me](https://example.com)"}</Markdown>);
    const link = screen.getByText("click me") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders h1-h4 headings", () => {
    render(<Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>);
    expect(screen.getByText("H1").tagName).toBe("H1");
    expect(screen.getByText("H2").tagName).toBe("H2");
    expect(screen.getByText("H3").tagName).toBe("H3");
    expect(screen.getByText("H4").tagName).toBe("H4");
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    expect(screen.getByText("quoted text").closest("blockquote")).not.toBeNull();
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"before\n\n---\n\nafter"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with th/td cells wrapped in an overflow container", () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{table}</Markdown>);
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
    expect(container.querySelector(".overflow-x-auto")).not.toBeNull();
  });

  it("applies a custom className to the wrapping div", () => {
    const { container } = render(<Markdown className="custom-class">{"text"}</Markdown>);
    expect(container.querySelector("div.custom-class")).not.toBeNull();
  });
});
