import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders bold text using the strong component with the expected styling", () => {
    render(<Markdown>{"**bold text**"}</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-semibold");
  });

  it("renders italic text using the em component", () => {
    render(<Markdown>{"_italic text_"}</Markdown>);
    const em = screen.getByText("italic text");
    expect(em.tagName).toBe("EM");
    expect(em.className).toContain("italic");
  });

  it("renders a link with target=_blank and rel=noreferrer noopener", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders inline code without the block code styling", () => {
    render(<Markdown>{"use `inline()` here"}</Markdown>);
    const code = screen.getByText("inline()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("whitespace-pre");
  });

  it("renders fenced code blocks with block code styling", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("whitespace-pre");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one").closest("ul")).not.toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders an ordered list with list items", () => {
    render(<Markdown>{"1. one\n2. two"}</Markdown>);
    const ol = screen.getByText("one").closest("ol");
    expect(ol).not.toBeNull();
    expect(ol!.className).toContain("list-decimal");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders headings h1 through h4 with their expected tag and styling", () => {
    render(
      <Markdown>
        {"# Heading 1\n\n## Heading 2\n\n### Heading 3\n\n#### Heading 4"}
      </Markdown>,
    );
    const h1 = screen.getByText("Heading 1");
    expect(h1.tagName).toBe("H1");
    expect(h1.className).toContain("text-sm");

    const h2 = screen.getByText("Heading 2");
    expect(h2.tagName).toBe("H2");
    expect(h2.className).toContain("text-sm");

    const h3 = screen.getByText("Heading 3");
    expect(h3.tagName).toBe("H3");
    expect(h3.className).toContain("text-xs");

    const h4 = screen.getByText("Heading 4");
    expect(h4.tagName).toBe("H4");
    expect(h4.className).toContain("text-xs");
  });

  it("renders a blockquote with the expected styling", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    const quote = screen.getByText("quoted text").closest("blockquote");
    expect(quote).not.toBeNull();
    expect(quote!.className).toContain("border-l-2");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    const hr = container.querySelector("hr");
    expect(hr).not.toBeNull();
    expect(hr!.className).toContain("border-border-subtle");
  });

  it("renders a GFM table (via remark-gfm) with headers and cells", () => {
    render(
      <Markdown>
        {"| A | B |\n| --- | --- |\n| 1 | 2 |"}
      </Markdown>,
    );
    expect(screen.getByRole("columnheader", { name: "A" })).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
  });

  it("merges a custom className onto the wrapper div", () => {
    const { container } = render(
      <Markdown className="extra-class">{"plain text"}</Markdown>,
    );
    expect(container.firstChild).not.toBeNull();
    expect((container.firstChild as HTMLElement).className).toContain("extra-class");
  });
});
