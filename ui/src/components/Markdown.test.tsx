import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders paragraphs", () => {
    render(<Markdown>{"Hello world"}</Markdown>);
    expect(screen.getByText("Hello world").tagName).toBe("P");
  });

  it("renders a bulleted list", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one").closest("ul")).not.toBeNull();
    expect(screen.getByText("two").tagName).toBe("LI");
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    expect(screen.getByText("first").closest("ol")).not.toBeNull();
  });

  it("renders bold and italic text", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
  });

  it("renders an inline code span without the block styling", () => {
    render(<Markdown>{"use `inline()` here"}</Markdown>);
    const code = screen.getByText("inline()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders a fenced code block with block styling", () => {
    render(<Markdown>{"```js\nconst a = 1;\n```"}</Markdown>);
    const code = screen.getByText(/const a = 1;/);
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
  });

  it("renders a link with target=_blank and rel attributes", () => {
    render(<Markdown>{"[click me](https://example.com)"}</Markdown>);
    const link = screen.getByText("click me");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders headings h1 through h4", () => {
    render(<Markdown>{"# H1\n## H2\n### H3\n#### H4"}</Markdown>);
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

  it("renders a GFM table with th/td cells", () => {
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
      <Markdown className="custom-wrap">{"text"}</Markdown>,
    );
    expect(container.firstElementChild?.className).toContain("custom-wrap");
  });
});
