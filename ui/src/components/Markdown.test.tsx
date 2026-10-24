import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph", () => {
    render(<Markdown>{"Hello world"}</Markdown>);
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("renders bold and italic text with the expected styling", () => {
    const { container } = render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one")).toBeDefined();
    expect(screen.getByText("two")).toBeDefined();
  });

  it("renders an ordered list", () => {
    const { container } = render(<Markdown>{"1. first\n2. second"}</Markdown>);
    expect(container.querySelector("ol")).not.toBeNull();
  });

  it("renders inline code distinct from a fenced code block", () => {
    const { container } = render(<Markdown>{"`inline`"}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.textContent).toBe("inline");
    expect(code?.className).not.toContain("block");
  });

  it("renders a fenced code block with block styling", () => {
    const { container } = render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.className).toContain("block");
    expect(code?.textContent).toContain("const x = 1;");
  });

  it("renders a link with target=_blank and rel attributes", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders headings h1 through h4", () => {
    const { container } = render(
      <Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>,
    );
    expect(container.querySelector("h1")?.textContent).toBe("H1");
    expect(container.querySelector("h2")?.textContent).toBe("H2");
    expect(container.querySelector("h3")?.textContent).toBe("H3");
    expect(container.querySelector("h4")?.textContent).toBe("H4");
  });

  it("renders a blockquote", () => {
    const { container } = render(<Markdown>{"> quoted text"}</Markdown>);
    expect(container.querySelector("blockquote")?.textContent).toContain("quoted text");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"---"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with header and data cells", () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{table}</Markdown>);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("th")?.textContent).toBe("A");
    expect(container.querySelector("td")?.textContent).toBe("1");
  });

  it("applies a custom className to the wrapper", () => {
    const { container } = render(<Markdown className="extra-class">{"text"}</Markdown>);
    expect(container.querySelector(".extra-class")).not.toBeNull();
  });
});
