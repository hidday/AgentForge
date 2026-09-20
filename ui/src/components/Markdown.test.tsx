import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph", () => {
    render(<Markdown>{"Hello world"}</Markdown>);
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("renders bold text with strong styling", () => {
    render(<Markdown>{"**bold text**"}</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-semibold");
  });

  it("renders italic text", () => {
    render(<Markdown>{"*italic text*"}</Markdown>);
    const em = screen.getByText("italic text");
    expect(em.tagName).toBe("EM");
  });

  it("renders an unordered list with items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one").tagName).toBe("LI");
    expect(screen.getByText("two").tagName).toBe("LI");
    expect(screen.getByText("one").closest("ul")).not.toBeNull();
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    expect(screen.getByText("first").closest("ol")).not.toBeNull();
  });

  it("renders h2, h3, and h4 headings", () => {
    render(<Markdown>{"## Two\n### Three\n#### Four"}</Markdown>);
    expect(screen.getByText("Two").tagName).toBe("H2");
    expect(screen.getByText("Three").tagName).toBe("H3");
    expect(screen.getByText("Four").tagName).toBe("H4");
  });

  it("renders inline code with monospace styling", () => {
    render(<Markdown>{"Use `npm test` to run tests"}</Markdown>);
    const code = screen.getByText("npm test");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("font-mono");
  });

  it("renders a fenced code block with block styling", () => {
    render(<Markdown>{"```js\nconsole.log(1)\n```"}</Markdown>);
    const code = screen.getByText("console.log(1)");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
  });

  it("renders links opening in a new tab with rel=noreferrer noopener", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders headings", () => {
    render(<Markdown>{"# Heading One"}</Markdown>);
    expect(screen.getByText("Heading One").tagName).toBe("H1");
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    const quote = screen.getByText("quoted text");
    expect(quote.closest("blockquote")).not.toBeNull();
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"---"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with th/td cells (remark-gfm)", () => {
    const table = "| A | B |\n| - | - |\n| 1 | 2 |";
    render(<Markdown>{table}</Markdown>);
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("applies a custom className to the wrapping div", () => {
    const { container } = render(<Markdown className="custom-md">{"text"}</Markdown>);
    expect(container.querySelector(".custom-md")).not.toBeNull();
  });
});
