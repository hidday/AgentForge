import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders paragraphs", () => {
    render(<Markdown>{"Hello world"}</Markdown>);
    const p = screen.getByText("Hello world");
    expect(p.tagName).toBe("P");
    expect(p.className).toContain("mb-2");
  });

  it("renders headings h1-h4", () => {
    const md = "# H1\n\n## H2\n\n### H3\n\n#### H4";
    render(<Markdown>{md}</Markdown>);
    expect(screen.getByText("H1").tagName).toBe("H1");
    expect(screen.getByText("H2").tagName).toBe("H2");
    expect(screen.getByText("H3").tagName).toBe("H3");
    expect(screen.getByText("H4").tagName).toBe("H4");
  });

  it("renders unordered and ordered lists with list items", () => {
    const md = "- one\n- two\n\n1. first\n2. second";
    const { container } = render(<Markdown>{md}</Markdown>);
    const ul = container.querySelector("ul");
    const ol = container.querySelector("ol");
    expect(ul).not.toBeNull();
    expect(ol).not.toBeNull();
    expect(ul?.className).toContain("list-disc");
    expect(ol?.className).toContain("list-decimal");
    expect(screen.getByText("one").tagName).toBe("LI");
    expect(screen.getByText("first").tagName).toBe("LI");
  });

  it("renders strong and emphasis", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const strong = screen.getByText("bold");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-semibold");
    const em = screen.getByText("italic");
    expect(em.tagName).toBe("EM");
    expect(em.className).toContain("italic");
  });

  it("renders inline code", () => {
    render(<Markdown>{"Use `const x = 1` here"}</Markdown>);
    const code = screen.getByText("const x = 1");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("px-1");
    expect(code.className).not.toContain("block");
  });

  it("renders fenced code blocks distinctly from inline code", () => {
    const md = "```js\nconst x = 1;\n```";
    const { container } = render(<Markdown>{md}</Markdown>);
    const code = container.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code?.className).toContain("block");
    expect(code?.textContent).toContain("const x = 1;");
  });

  it("renders links with target=_blank and rel attributes", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByText("click here") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders blockquotes", () => {
    const { container } = render(<Markdown>{"> a quote"}</Markdown>);
    const bq = container.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq?.textContent).toContain("a quote");
  });

  it("renders horizontal rules", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders GFM tables via remark-gfm", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{md}</Markdown>);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const th = container.querySelector("th");
    expect(th?.textContent).toBe("A");
    const td = container.querySelector("td");
    expect(td?.textContent).toBe("1");
  });

  it("applies the className prop to the wrapping div", () => {
    const { container } = render(
      <Markdown className="my-custom-class">{"text"}</Markdown>,
    );
    expect(container.firstElementChild?.className).toContain(
      "my-custom-class",
    );
  });

  it("applies the base text-text-secondary class even without a className prop", () => {
    const { container } = render(<Markdown>{"text"}</Markdown>);
    expect(container.firstElementChild?.className).toContain(
      "text-text-secondary",
    );
  });
});
