import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain text as a paragraph", () => {
    render(<Markdown>{"Just plain text"}</Markdown>);
    const p = screen.getByText("Just plain text");
    expect(p.tagName).toBe("P");
    expect(p.className).toContain("mb-2");
  });

  it("renders an empty string without throwing and without any paragraph", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.querySelector("p")).toBeNull();
  });

  it("renders bold text (**text**) as a <strong> element", () => {
    render(<Markdown>{"This is **bold** text"}</Markdown>);
    const strong = screen.getByText("bold");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-semibold");
  });

  it("renders italic text (*text*) as an <em> element", () => {
    render(<Markdown>{"This is *italic* text"}</Markdown>);
    const em = screen.getByText("italic");
    expect(em.tagName).toBe("EM");
    expect(em.className).toContain("italic");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- one\n- two\n- three"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toBe("one");
    expect(items[2].textContent).toBe("three");
  });

  it("renders an ordered list as an <ol> element", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders an inline code span (no language) with inline styling", () => {
    render(<Markdown>{"Use the `foo()` function"}</Markdown>);
    const code = screen.getByText("foo()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("px-1");
    expect(code.className).not.toContain("block");
  });

  it("renders a fenced code block (with language) as a block-level code element inside <pre>", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
    expect(code.closest("pre")).not.toBeNull();
  });

  it("renders a link with target=_blank and rel=noreferrer noopener", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders headings (h1-h4) with the custom heading components", () => {
    render(<Markdown>{"# Heading 1\n\n## Heading 2\n\n### Heading 3\n\n#### Heading 4"}</Markdown>);
    expect(screen.getByRole("heading", { level: 1, name: "Heading 1" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "Heading 2" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 3, name: "Heading 3" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 4, name: "Heading 4" })).toBeDefined();
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    const quote = screen.getByText("quoted text");
    expect(quote.closest("blockquote")).not.toBeNull();
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with th/td cells via remark-gfm", () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    render(<Markdown>{table}</Markdown>);
    expect(screen.getByRole("columnheader", { name: "A" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "B" })).toBeDefined();
    expect(screen.getByRole("cell", { name: "1" })).toBeDefined();
    expect(screen.getByRole("cell", { name: "2" })).toBeDefined();
  });

  it("applies an additional className to the wrapper div", () => {
    const { container } = render(
      <Markdown className="custom-wrapper">{"text"}</Markdown>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("custom-wrapper");
    expect(wrapper.className).toContain("text-text-secondary");
  });
});
