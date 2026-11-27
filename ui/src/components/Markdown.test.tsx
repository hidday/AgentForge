import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph of plain text", () => {
    render(<Markdown>{"Hello world"}</Markdown>);
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("renders an unordered list with items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one").closest("ul")).not.toBeNull();
    expect(screen.getByText("two")).toBeDefined();
  });

  it("renders an ordered list with items", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    expect(screen.getByText("first").closest("ol")).not.toBeNull();
    expect(screen.getByText("second")).toBeDefined();
  });

  it("renders bold and italic text", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
  });

  it("renders inline code without the block styling", () => {
    render(<Markdown>{"use `inline()` here"}</Markdown>);
    const code = screen.getByText("inline()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders a fenced code block with block styling", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
  });

  it("renders a link with target=_blank and rel attributes", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByText("click here");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders headings h1 through h4", () => {
    render(
      <Markdown>
        {"# h1\n\n## h2\n\n### h3\n\n#### h4"}
      </Markdown>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("h1");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("h2");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("h3");
    expect(screen.getByRole("heading", { level: 4 }).textContent).toBe("h4");
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    const quote = screen.getByText("quoted text");
    expect(quote.closest("blockquote")).not.toBeNull();
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"before\n\n---\n\nafter"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with th and td cells", () => {
    render(
      <Markdown>
        {"| A | B |\n| --- | --- |\n| 1 | 2 |"}
      </Markdown>,
    );
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("applies a custom className to the wrapper", () => {
    const { container } = render(
      <Markdown className="my-markdown-class">{"text"}</Markdown>,
    );
    expect((container.firstChild as HTMLElement).className).toContain(
      "my-markdown-class",
    );
  });
});
