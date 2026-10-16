import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders headings h1-h4 with their text content", () => {
    const { container } = render(
      <Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>,
    );
    expect(container.querySelector("h1")?.textContent).toBe("H1");
    expect(container.querySelector("h2")?.textContent).toBe("H2");
    expect(container.querySelector("h3")?.textContent).toBe("H3");
    expect(container.querySelector("h4")?.textContent).toBe("H4");
  });

  it("renders a paragraph with bold and italic inline formatting", () => {
    const { container } = render(
      <Markdown>{"Some **bold** and *italic* text."}</Markdown>,
    );
    expect(container.querySelector("p")).not.toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
  });

  it("renders unordered lists with list items", () => {
    const { container } = render(<Markdown>{"- Item one\n- Item two"}</Markdown>);
    expect(container.querySelector("ul")).not.toBeNull();
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("Item one");
    expect(items[1].textContent).toBe("Item two");
  });

  it("renders ordered lists with list items", () => {
    const { container } = render(<Markdown>{"1. First\n2. Second"}</Markdown>);
    expect(container.querySelector("ol")).not.toBeNull();
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("First");
    expect(items[1].textContent).toBe("Second");
  });

  it("renders a blockquote", () => {
    const { container } = render(<Markdown>{"> A quote"}</Markdown>);
    expect(container.querySelector("blockquote")?.textContent?.trim()).toBe("A quote");
  });

  it("renders inline code without the block-styling class", () => {
    const { container } = render(<Markdown>{"Use `inline code` here."}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.textContent).toBe("inline code");
    expect(code?.className).not.toContain("block");
  });

  it("renders fenced code blocks inside a pre with block styling", () => {
    const { container } = render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    const code = pre?.querySelector("code");
    expect(code?.textContent?.trim()).toBe("const x = 1;");
    expect(code?.className).toContain("block");
  });

  it("renders links that open in a new tab with safe rel attributes", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders GFM strikethrough text", () => {
    const { container } = render(<Markdown>{"~~gone~~"}</Markdown>);
    expect(container.querySelector("del")?.textContent).toBe("gone");
  });

  it("renders GFM tables with header and body cells", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{md}</Markdown>);
    expect(container.querySelector("table")).not.toBeNull();
    const headers = container.querySelectorAll("th");
    expect(headers).toHaveLength(2);
    expect(headers[0].textContent).toBe("A");
    expect(headers[1].textContent).toBe("B");
    const cells = container.querySelectorAll("td");
    expect(cells).toHaveLength(2);
    expect(cells[0].textContent).toBe("1");
    expect(cells[1].textContent).toBe("2");
  });

  it("applies the wrapping className alongside the default text color class", () => {
    const { container } = render(<Markdown className="custom-wrap">{"text"}</Markdown>);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.className).toContain("custom-wrap");
    expect(wrapper.className).toContain("text-text-secondary");
  });
});
