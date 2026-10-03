import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain text content", () => {
    render(<Markdown>{"Just plain text."}</Markdown>);
    expect(screen.getByText("Just plain text.")).toBeDefined();
  });

  it("renders empty content without throwing", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.querySelector("div")).not.toBeNull();
  });

  it("renders headings with appropriate tag and styling classes", () => {
    render(<Markdown>{"# Heading One"}</Markdown>);
    const heading = screen.getByText("Heading One");
    expect(heading.tagName).toBe("H1");
    expect(heading.className).toContain("font-semibold");
  });

  it("renders an inline code span distinctly from a fenced code block", () => {
    render(<Markdown>{"Use `inline()` code."}</Markdown>);
    const inline = screen.getByText("inline()");
    expect(inline.tagName).toBe("CODE");
    expect(inline.className).toContain("px-1");
  });

  it("renders a fenced code block with block styling", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const block = screen.getByText("const x = 1;");
    expect(block.tagName).toBe("CODE");
    expect(block.className).toContain("block");
  });

  it("renders links with target=_blank and rel attributes", () => {
    render(<Markdown>{"[Anthropic](https://anthropic.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "Anthropic" });
    expect(link.getAttribute("href")).toBe("https://anthropic.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders unordered list items", () => {
    render(<Markdown>{"- first\n- second"}</Markdown>);
    expect(screen.getByText("first")).toBeDefined();
    expect(screen.getByText("second")).toBeDefined();
    expect(screen.getByText("first").closest("ul")).not.toBeNull();
  });

  it("renders a table with headers and cells", () => {
    render(
      <Markdown>
        {"| A | B |\n| --- | --- |\n| 1 | 2 |"}
      </Markdown>,
    );
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("renders an ordered list with its items", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByText("first").closest("ol");
    expect(list).not.toBeNull();
    expect(screen.getByText("second")).toBeDefined();
  });

  it("renders emphasized (italic) text", () => {
    render(<Markdown>{"This is *italic* text."}</Markdown>);
    const em = screen.getByText("italic");
    expect(em.tagName).toBe("EM");
    expect(em.className).toContain("italic");
  });

  it("renders h2, h3, and h4 headings with their respective tags", () => {
    render(
      <Markdown>
        {"## Heading Two\n\n### Heading Three\n\n#### Heading Four"}
      </Markdown>,
    );
    expect(screen.getByText("Heading Two").tagName).toBe("H2");
    expect(screen.getByText("Heading Three").tagName).toBe("H3");
    expect(screen.getByText("Heading Four").tagName).toBe("H4");
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> A quoted insight."}</Markdown>);
    const quote = screen.getByText("A quoted insight.");
    expect(quote.closest("blockquote")).not.toBeNull();
  });

  it("renders a horizontal rule between two paragraphs", () => {
    const { container } = render(
      <Markdown>{"Before.\n\n---\n\nAfter."}</Markdown>,
    );
    expect(container.querySelector("hr")).not.toBeNull();
    expect(screen.getByText("Before.")).toBeDefined();
    expect(screen.getByText("After.")).toBeDefined();
  });

  it("applies a custom className to the wrapping element", () => {
    const { container } = render(
      <Markdown className="custom-md">{"hello"}</Markdown>,
    );
    expect(container.querySelector("div.custom-md")).not.toBeNull();
  });
});
