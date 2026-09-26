import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain paragraph text", () => {
    render(<Markdown>Hello world</Markdown>);
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("renders bold text with the strong styling", () => {
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

  it("renders unordered list items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one").tagName).toBe("LI");
    expect(screen.getByText("two").tagName).toBe("LI");
  });

  it("renders an inline code span with inline styling", () => {
    render(<Markdown>{"`inline`"}</Markdown>);
    const code = screen.getByText("inline");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("rounded");
    expect(code.className).not.toContain("block");
  });

  it("renders a fenced code block with block styling", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
  });

  it("renders a link that opens in a new tab", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders ordered list items", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    expect(screen.getByText("first").tagName).toBe("LI");
    const list = screen.getByText("first").closest("ol");
    expect(list).not.toBeNull();
    expect(list!.className).toContain("list-decimal");
  });

  it("renders h1-h4 headings with the expected tag names", () => {
    render(<Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>);
    expect(screen.getByText("H1").tagName).toBe("H1");
    expect(screen.getByText("H2").tagName).toBe("H2");
    expect(screen.getByText("H3").tagName).toBe("H3");
    expect(screen.getByText("H4").tagName).toBe("H4");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    const quote = screen.getByText("quoted text");
    expect(quote.closest("blockquote")).not.toBeNull();
  });

  it("renders a GFM table via remark-gfm", () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    render(<Markdown>{table}</Markdown>);
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("applies a custom className to the wrapper div", () => {
    const { container } = render(<Markdown className="custom-md">Text</Markdown>);
    expect(container.firstElementChild!.className).toContain("custom-md");
  });
});
