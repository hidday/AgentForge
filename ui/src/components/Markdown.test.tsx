import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph and applies the passed className to the wrapper", () => {
    const { container } = render(
      <Markdown className="my-class">Hello world</Markdown>,
    );
    expect(screen.getByText("Hello world")).toBeDefined();
    expect(container.firstChild).not.toBeNull();
    expect((container.firstChild as HTMLElement).className).toContain("my-class");
  });

  it("renders bold and italic text with custom styling classes", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const strong = screen.getByText("bold");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-semibold");
    const em = screen.getByText("italic");
    expect(em.tagName).toBe("EM");
    expect(em.className).toContain("italic");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one")).toBeDefined();
    expect(screen.getByText("two")).toBeDefined();
    const list = screen.getByText("one").closest("ul");
    expect(list).not.toBeNull();
    expect(list!.className).toContain("list-disc");
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByText("first").closest("ol");
    expect(list).not.toBeNull();
    expect(list!.className).toContain("list-decimal");
  });

  it("renders a link with target=_blank and rel attributes", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders inline code without the block wrapper class", () => {
    render(<Markdown>{"use `inline()` here"}</Markdown>);
    const code = screen.getByText("inline()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders a fenced code block with the block styling class", () => {
    render(<Markdown>{"```js\nconst a = 1;\n```"}</Markdown>);
    const code = screen.getByText("const a = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
  });

  it("renders headings at every supported level", () => {
    render(<Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>);
    expect(screen.getByText("H1").tagName).toBe("H1");
    expect(screen.getByText("H2").tagName).toBe("H2");
    expect(screen.getByText("H3").tagName).toBe("H3");
    expect(screen.getByText("H4").tagName).toBe("H4");
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    const quote = screen.getByText("quoted text").closest("blockquote");
    expect(quote).not.toBeNull();
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with th/td cells", () => {
    render(
      <Markdown>
        {"| Name | Value |\n| --- | --- |\n| a | 1 |"}
      </Markdown>,
    );
    expect(screen.getByText("Name").tagName).toBe("TH");
    expect(screen.getByText("a").tagName).toBe("TD");
  });
});
