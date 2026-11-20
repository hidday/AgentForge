import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders bold and italic text", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const strong = screen.getByText("bold");
    expect(strong.tagName).toBe("STRONG");
    const em = screen.getByText("italic");
    expect(em.tagName).toBe("EM");
  });

  it("renders an unordered list with its items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    expect(screen.getByText("one")).toBeDefined();
    expect(screen.getByText("two")).toBeDefined();
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
  });

  it("renders inline code without the block styling class", () => {
    render(<Markdown>{"use `inline()` here"}</Markdown>);
    const code = screen.getByText("inline()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders fenced code blocks with the block styling class", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
  });

  it("renders links with target=_blank and rel attributes", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders headings", () => {
    render(
      <Markdown>{"# Title\n\n## Subtitle\n\n### Section\n\n#### Sub-section"}</Markdown>,
    );
    expect(screen.getByText("Title").tagName).toBe("H1");
    expect(screen.getByText("Subtitle").tagName).toBe("H2");
    expect(screen.getByText("Section").tagName).toBe("H3");
    expect(screen.getByText("Sub-section").tagName).toBe("H4");
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

  it("renders a GFM table with th/td cells", () => {
    render(
      <Markdown>{"| A | B |\n| --- | --- |\n| 1 | 2 |"}</Markdown>,
    );
    expect(screen.getByRole("columnheader", { name: "A" })).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
  });

  it("applies the passed className to the wrapping div", () => {
    const { container } = render(
      <Markdown className="custom-class">{"plain text"}</Markdown>,
    );
    expect(container.firstElementChild?.className).toContain("custom-class");
  });
});
