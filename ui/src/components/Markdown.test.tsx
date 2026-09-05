import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph and applies the wrapper className", () => {
    const { container } = render(
      <Markdown className="my-class">Hello world</Markdown>,
    );
    expect(screen.getByText("Hello world").tagName).toBe("P");
    expect(container.firstElementChild?.className).toContain("my-class");
  });

  it("renders unordered and ordered lists with list items", () => {
    render(<Markdown>{"- one\n- two\n\n1. first\n2. second"}</Markdown>);
    expect(screen.getByText("one").closest("ul")).not.toBeNull();
    expect(screen.getByText("first").closest("ol")).not.toBeNull();
    expect(screen.getAllByRole("listitem").length).toBe(4);
  });

  it("renders bold and italic text", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
  });

  it("renders inline code without the block styling", () => {
    render(<Markdown>{"Use `inline()` here"}</Markdown>);
    const code = screen.getByText("inline()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders fenced code blocks with block styling inside a pre", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
    expect(code.closest("pre")).not.toBeNull();
  });

  it("renders links that open in a new tab safely", () => {
    render(<Markdown>{"[click me](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click me" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders headings h1 through h4", () => {
    render(
      <Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>,
    );
    expect(screen.getByText("H1").tagName).toBe("H1");
    expect(screen.getByText("H2").tagName).toBe("H2");
    expect(screen.getByText("H3").tagName).toBe("H3");
    expect(screen.getByText("H4").tagName).toBe("H4");
  });

  it("renders blockquotes and horizontal rules", () => {
    const { container } = render(
      <Markdown>{"> a quote\n\n---\n\nafter"}</Markdown>,
    );
    expect(screen.getByText("a quote").closest("blockquote")).not.toBeNull();
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders GFM tables via remark-gfm with th/td cells", () => {
    render(
      <Markdown>
        {"| A | B |\n| --- | --- |\n| 1 | 2 |"}
      </Markdown>,
    );
    expect(screen.getByRole("columnheader", { name: "A" })).toBeDefined();
    expect(screen.getByRole("cell", { name: "1" })).toBeDefined();
  });
});
