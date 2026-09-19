import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph and applies the wrapper className", () => {
    const { container } = render(
      <Markdown className="custom-class">Hello world</Markdown>,
    );
    expect(screen.getByText("Hello world")).toBeDefined();
    expect(container.querySelector(".custom-class")).not.toBeNull();
  });

  it("renders bold and italic text", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one").closest("ul")).not.toBeNull();
    expect(screen.getByText("two")).toBeDefined();
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    expect(screen.getByText("first").closest("ol")).not.toBeNull();
  });

  it("renders inline code without the block styling", () => {
    render(<Markdown>{"Use `inline()` code"}</Markdown>);
    const code = screen.getByText("inline()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders a fenced code block with block styling", () => {
    render(<Markdown>{"```js\nconsole.log(1);\n```"}</Markdown>);
    const code = screen.getByText("console.log(1);");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
  });

  it("renders a link with target=_blank and rel attributes", () => {
    render(<Markdown>{"[link text](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "link text" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders headings h1 through h4", () => {
    render(<Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("H1");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("H2");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("H3");
    expect(screen.getByRole("heading", { level: 4 }).textContent).toBe("H4");
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    expect(screen.getByText("quoted text").closest("blockquote")).not.toBeNull();
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with th/td cells", () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    render(<Markdown>{table}</Markdown>);
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });
});
