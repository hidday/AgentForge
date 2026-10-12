import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain paragraph text", () => {
    render(<Markdown>{"Hello world"}</Markdown>);
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("renders an empty container for empty content without crashing", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.textContent).toBe("");
  });

  it("renders headings with the expected tag and styling", () => {
    render(<Markdown>{"# Big Heading"}</Markdown>);
    const heading = screen.getByText("Big Heading");
    expect(heading.tagName).toBe("H1");
    expect(heading.className).toContain("font-semibold");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- one\n- two\n- three"}</Markdown>);
    expect(screen.getByText("one")).toBeDefined();
    expect(screen.getByText("two")).toBeDefined();
    expect(screen.getByText("three")).toBeDefined();
    const list = screen.getByText("one").closest("ul");
    expect(list).not.toBeNull();
    expect(list?.className).toContain("list-disc");
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByText("first").closest("ol");
    expect(list).not.toBeNull();
    expect(list?.className).toContain("list-decimal");
  });

  it("renders bold and italic text with the correct tags", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const bold = screen.getByText("bold");
    expect(bold.tagName).toBe("STRONG");
    const italic = screen.getByText("italic");
    expect(italic.tagName).toBe("EM");
  });

  it("renders inline code with inline styling (no block class)", () => {
    render(<Markdown>{"Use `const x = 1` here"}</Markdown>);
    const code = screen.getByText("const x = 1");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders fenced code blocks with block styling", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
  });

  it("renders links that open in a new tab with safe rel attributes", () => {
    render(<Markdown>{"[click me](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click me" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    const quote = screen.getByText("quoted text");
    expect(quote.closest("blockquote")).not.toBeNull();
  });

  it("renders a GFM table via remark-gfm", () => {
    render(
      <Markdown>
        {"| A | B |\n| --- | --- |\n| 1 | 2 |"}
      </Markdown>,
    );
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("applies the passed-in className to the wrapper", () => {
    const { container } = render(
      <Markdown className="custom-class">{"text"}</Markdown>,
    );
    expect(container.firstElementChild?.className).toContain("custom-class");
  });
});
