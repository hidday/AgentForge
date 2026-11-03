import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph", () => {
    render(<Markdown>Hello world</Markdown>);
    expect(screen.getByText("Hello world").tagName).toBe("P");
  });

  it("renders bold text with strong styling", () => {
    render(<Markdown>**bold text**</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-semibold");
  });

  it("renders italic text", () => {
    render(<Markdown>*italic text*</Markdown>);
    const em = screen.getByText("italic text");
    expect(em.tagName).toBe("EM");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one").tagName).toBe("LI");
    expect(screen.getByText("two").tagName).toBe("LI");
    expect(screen.getByText("one").closest("ul")).not.toBeNull();
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    expect(screen.getByText("first").closest("ol")).not.toBeNull();
  });

  it("renders an inline code span", () => {
    render(<Markdown>{"Use `cn()` helper"}</Markdown>);
    const code = screen.getByText("cn()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders a fenced code block with block styling", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
  });

  it("renders a link with target=_blank and rel attributes", () => {
    render(<Markdown>{"[click](https://example.com)"}</Markdown>);
    const link = screen.getByText("click");
    expect(link.tagName).toBe("A");
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
    render(<Markdown>{"> quoted text"}</Markdown>);
    const quote = screen.getByText("quoted text");
    expect(quote.closest("blockquote")).not.toBeNull();
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with th/td cells", () => {
    render(
      <Markdown>
        {"| A | B |\n| --- | --- |\n| 1 | 2 |"}
      </Markdown>,
    );
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("applies the passed className to the wrapper", () => {
    const { container } = render(<Markdown className="my-class">text</Markdown>);
    expect(container.firstChild).not.toBeNull();
    expect((container.firstChild as HTMLElement).className).toContain("my-class");
  });

  it("applies the base text-text-secondary class even without a custom className", () => {
    const { container } = render(<Markdown>text</Markdown>);
    expect((container.firstChild as HTMLElement).className).toContain("text-text-secondary");
  });
});
