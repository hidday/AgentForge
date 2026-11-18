import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph", () => {
    render(<Markdown>{"Hello world"}</Markdown>);
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("renders a bulleted list", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one")).toBeDefined();
    expect(screen.getByText("two")).toBeDefined();
    expect(document.querySelector("ul")).not.toBeNull();
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    expect(document.querySelector("ol")).not.toBeNull();
    expect(screen.getByText("first")).toBeDefined();
  });

  it("renders bold text with strong styling", () => {
    render(<Markdown>{"**bold text**"}</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renders italic text with em styling", () => {
    render(<Markdown>{"*italic text*"}</Markdown>);
    const em = screen.getByText("italic text");
    expect(em.tagName).toBe("EM");
  });

  it("renders inline code", () => {
    render(<Markdown>{"Use `cn()` helper"}</Markdown>);
    const code = screen.getByText("cn()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders a fenced code block", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
  });

  it("renders a link opening in a new tab", () => {
    render(<Markdown>{"[click me](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click me" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders headings h1 through h4", () => {
    render(<Markdown>{"# H1\n## H2\n### H3\n#### H4"}</Markdown>);
    expect(screen.getByText("H1").tagName).toBe("H1");
    expect(screen.getByText("H2").tagName).toBe("H2");
    expect(screen.getByText("H3").tagName).toBe("H3");
    expect(screen.getByText("H4").tagName).toBe("H4");
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> a quote"}</Markdown>);
    const quote = screen.getByText("a quote");
    expect(quote.closest("blockquote")).not.toBeNull();
  });

  it("renders a horizontal rule", () => {
    render(<Markdown>{"before\n\n---\n\nafter"}</Markdown>);
    expect(document.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with header and data cells", () => {
    render(
      <Markdown>
        {"| Name | Value |\n| --- | --- |\n| foo | bar |"}
      </Markdown>,
    );
    expect(screen.getByText("Name").tagName).toBe("TH");
    expect(screen.getByText("foo").tagName).toBe("TD");
  });

  it("applies the passed className to the wrapper", () => {
    const { container } = render(
      <Markdown className="custom-class">{"text"}</Markdown>,
    );
    expect((container.firstChild as HTMLElement).className).toContain("custom-class");
  });
});
