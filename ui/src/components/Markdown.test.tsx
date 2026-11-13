import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph with the mb-2 styling", () => {
    const { container } = render(<Markdown>{"Hello world"}</Markdown>);
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p!.textContent).toBe("Hello world");
    expect(p!.className).toContain("mb-2");
  });

  it("renders bold and italic text", () => {
    const { container } = render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const strong = container.querySelector("strong");
    const em = container.querySelector("em");
    expect(strong?.textContent).toBe("bold");
    expect(em?.textContent).toBe("italic");
  });

  it("renders an unordered list with list items", () => {
    const { container } = render(<Markdown>{"- one\n- two"}</Markdown>);
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul!.className).toContain("list-disc");
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("one");
  });

  it("renders an ordered list", () => {
    const { container } = render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol!.className).toContain("list-decimal");
  });

  it("renders inline code without the block styling", () => {
    const { container } = render(<Markdown>{"Use `foo()` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.textContent).toBe("foo()");
    expect(code!.className).not.toContain("block");
  });

  it("renders a fenced code block with the block styling", () => {
    const { container } = render(<Markdown>{"```js\nconst a = 1;\n```"}</Markdown>);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.className).toContain("block");
    expect(code!.textContent).toContain("const a = 1;");
  });

  it("renders a link with target=_blank and rel=noreferrer noopener", () => {
    render(<Markdown>{"[click me](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click me" });
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
    const { container } = render(<Markdown>{"> a quote"}</Markdown>);
    const bq = container.querySelector("blockquote");
    expect(bq?.textContent).toContain("a quote");
    expect(bq!.className).toContain("border-l-2");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"before\n\n---\n\nafter"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with th/td cells", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{md}</Markdown>);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const ths = container.querySelectorAll("th");
    const tds = container.querySelectorAll("td");
    expect(ths.length).toBe(2);
    expect(tds.length).toBe(2);
    expect(ths[0].textContent).toBe("A");
    expect(tds[0].textContent).toBe("1");
  });

  it("applies the passed className to the wrapping div", () => {
    const { container } = render(
      <Markdown className="custom-wrapper">{"text"}</Markdown>,
    );
    expect(container.firstChild).not.toBeNull();
    expect((container.firstChild as HTMLElement).className).toContain("custom-wrapper");
  });
});
