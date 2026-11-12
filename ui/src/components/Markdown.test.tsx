import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders headings for all levels", () => {
    render(<Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>);
    expect(screen.getByRole("heading", { level: 1, name: "H1" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "H2" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 3, name: "H3" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 4, name: "H4" })).toBeDefined();
  });

  it("renders an unordered list with its items", () => {
    render(<Markdown>{"- one\n- two\n- three"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("one")).toBeDefined();
    expect(screen.getByText("three")).toBeDefined();
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders a link opening in a new tab with safe rel attributes", () => {
    render(<Markdown>{"[click me](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click me" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders a fenced code block distinctly from inline code", () => {
    const { container } = render(
      <Markdown>{"```js\nconst x = 1;\n```\n\nSome `inline` code."}</Markdown>,
    );
    const codes = container.querySelectorAll("code");
    expect(codes.length).toBe(2);
    // The fenced block renders with "block" display styling inside a <pre>.
    const block = Array.from(codes).find((c) => c.className.includes("block"));
    expect(block).toBeDefined();
    expect(block?.textContent).toContain("const x = 1;");
    expect(block?.closest("pre")).not.toBeNull();

    const inline = Array.from(codes).find(
      (c) => !c.className.includes("block"),
    );
    expect(inline).toBeDefined();
    expect(inline?.textContent).toBe("inline");
    expect(inline?.closest("pre")).toBeNull();
  });

  it("renders bold and italic text", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
  });

  it("renders a blockquote and a horizontal rule", () => {
    const { container } = render(<Markdown>{"> quoted text\n\n---"}</Markdown>);
    expect(screen.getByText("quoted text").closest("blockquote")).not.toBeNull();
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders GFM tables via remark-gfm", () => {
    const table = "| A | B |\n| - | - |\n| 1 | 2 |";
    render(<Markdown>{table}</Markdown>);
    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("applies the passed className to the wrapping div", () => {
    const { container } = render(
      <Markdown className="custom-class">hello</Markdown>,
    );
    expect(container.firstElementChild?.className).toContain("custom-class");
  });
});
