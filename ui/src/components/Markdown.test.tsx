import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain text inside a paragraph", () => {
    render(<Markdown>{"Just plain text"}</Markdown>);
    const p = screen.getByText("Just plain text");
    expect(p.tagName).toBe("P");
  });

  it("applies the passed className to the wrapper div", () => {
    const { container } = render(
      <Markdown className="custom-class">{"hello"}</Markdown>,
    );
    expect(container.querySelector("div.custom-class")).not.toBeNull();
    // base text color class is always applied
    expect(container.querySelector("div.text-text-secondary")).not.toBeNull();
  });

  it("renders headings h1 through h4 with the right tag names", () => {
    render(
      <Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>,
    );
    expect(screen.getByText("H1").tagName).toBe("H1");
    expect(screen.getByText("H2").tagName).toBe("H2");
    expect(screen.getByText("H3").tagName).toBe("H3");
    expect(screen.getByText("H4").tagName).toBe("H4");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- one\n- two\n- three"}</Markdown>);
    const list = screen.getByText("one").closest("ul");
    expect(list).not.toBeNull();
    expect(screen.getAllByRole("listitem").length).toBe(3);
  });

  it("renders an ordered list as an <ol>", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByText("first").closest("ol");
    expect(list).not.toBeNull();
  });

  it("renders bold and italic emphasis", () => {
    render(<Markdown>{"**bold text** and *italic text*"}</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
    const em = screen.getByText("italic text");
    expect(em.tagName).toBe("EM");
  });

  it("renders inline code as a code element without the block styling", () => {
    render(<Markdown>{"Use `const x = 1` here"}</Markdown>);
    const code = screen.getByText("const x = 1");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders fenced code blocks with block-level code styling", () => {
    const md = "```js\nconst x = 1;\n```";
    const { container } = render(<Markdown>{md}</Markdown>);
    const code = container.querySelector("code.block");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("const x = 1;");
  });

  it("renders links with target=_blank and rel=noreferrer noopener", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders blockquotes", () => {
    render(<Markdown>{"> a quoted line"}</Markdown>);
    const quote = screen.getByText("a quoted line").closest("blockquote");
    expect(quote).not.toBeNull();
  });

  it("renders a horizontal rule for --- input", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders GFM tables with th/td cells via remark-gfm", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{md}</Markdown>);
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("renders nothing meaningful for an empty string input", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.querySelector(".text-text-secondary")).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders malformed/unterminated markdown syntax without throwing", () => {
    const { container } = render(
      <Markdown>{"**unterminated bold and `unterminated code"}</Markdown>,
    );
    expect(container.textContent).toContain("unterminated");
  });
});
