import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain text with no markdown syntax", () => {
    render(<Markdown>Just some plain text.</Markdown>);
    expect(screen.getByText("Just some plain text.")).toBeDefined();
  });

  it("renders an empty string without throwing", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.querySelector("div")).toBeTruthy();
  });

  it("renders headings", () => {
    render(<Markdown>{"# Big heading\n\n### Small heading"}</Markdown>);
    expect(screen.getByText("Big heading").tagName).toBe("H1");
    expect(screen.getByText("Small heading").tagName).toBe("H3");
  });

  it("renders bold and italic text", () => {
    render(<Markdown>{"**bold text** and *italic text*"}</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
    const em = screen.getByText("italic text");
    expect(em.tagName).toBe("EM");
  });

  it("renders unordered and ordered lists", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one").closest("ul")).toBeTruthy();

    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    expect(screen.getByText("first").closest("ol")).toBeTruthy();
  });

  it("renders a link opening in a new tab", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders inline code without the block styling class", () => {
    render(<Markdown>{"use `inline()` here"}</Markdown>);
    const code = screen.getByText("inline()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders fenced code blocks with block styling", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    expect(screen.getByText("quoted text").closest("blockquote")).toBeTruthy();
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).toBeTruthy();
  });

  it("renders GFM tables via remark-gfm", () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    render(<Markdown>{table}</Markdown>);
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("applies the passed className to the wrapper div", () => {
    const { container } = render(
      <Markdown className="custom-class">hello</Markdown>,
    );
    expect(container.querySelector("div.custom-class")).toBeTruthy();
  });
});
