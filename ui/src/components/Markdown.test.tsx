import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain text wrapped in a paragraph", () => {
    render(<Markdown>Hello world</Markdown>);
    expect(screen.getByText("Hello world").tagName).toBe("P");
  });

  it("renders bold and italic text with the expected tags", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
  });

  it("renders an inline code span distinct from a fenced code block", () => {
    const { container } = render(
      <Markdown>{"Use `inline()` code"}</Markdown>,
    );
    const inline = screen.getByText("inline()");
    expect(inline.tagName).toBe("CODE");
    // Inline code should not use the block-styling class.
    expect(inline.className).not.toContain("block");
    expect(container.querySelector("pre")).toBeNull();
  });

  it("renders a fenced code block with block styling inside a <pre>", () => {
    const { container } = render(
      <Markdown>{"```js\nconst x = 1;\n```"}</Markdown>,
    );
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    const code = pre!.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.className).toContain("block");
    expect(code!.textContent).toContain("const x = 1;");
  });

  it("renders a link with target=_blank and rel=noreferrer noopener", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByText("click here");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders unordered and ordered lists with list items", () => {
    const { container } = render(
      <Markdown>{"- one\n- two\n\n1. first\n2. second"}</Markdown>,
    );
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.querySelectorAll("li").length).toBe(4);
  });

  it("renders headings h1-h4 with their respective tags", () => {
    const { container } = render(
      <Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>,
    );
    expect(container.querySelector("h1")!.textContent).toBe("H1");
    expect(container.querySelector("h2")!.textContent).toBe("H2");
    expect(container.querySelector("h3")!.textContent).toBe("H3");
    expect(container.querySelector("h4")!.textContent).toBe("H4");
  });

  it("renders a blockquote", () => {
    const { container } = render(<Markdown>{"> quoted text"}</Markdown>);
    const bq = container.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq!.textContent).toContain("quoted text");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with th/td cells via remark-gfm", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{md}</Markdown>);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("th").length).toBe(2);
    expect(container.querySelectorAll("td").length).toBe(2);
    expect(screen.getByText("A")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
  });

  it("applies the className prop to the wrapping div", () => {
    const { container } = render(
      <Markdown className="custom-class">text</Markdown>,
    );
    expect(container.firstChild).not.toBeNull();
    expect((container.firstChild as HTMLElement).className).toContain(
      "custom-class",
    );
  });
});
