import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph for plain text", () => {
    const { container } = render(<Markdown>{"Hello world"}</Markdown>);
    const p = container.querySelector("p");
    expect(p?.textContent).toBe("Hello world");
    expect(p?.className).toContain("mb-2");
  });

  it("renders an unordered list for bullet syntax", () => {
    const { container } = render(<Markdown>{"- one\n- two"}</Markdown>);
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul?.className).toContain("list-disc");
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("one");
    expect(items[1].textContent).toBe("two");
  });

  it("renders an ordered list for numbered syntax", () => {
    const { container } = render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol?.className).toContain("list-decimal");
  });

  it("renders bold text with strong styling", () => {
    const { container } = render(<Markdown>{"**bold text**"}</Markdown>);
    const strong = container.querySelector("strong");
    expect(strong?.textContent).toBe("bold text");
    expect(strong?.className).toContain("font-semibold");
  });

  it("renders italic text", () => {
    const { container } = render(<Markdown>{"*italic text*"}</Markdown>);
    const em = container.querySelector("em");
    expect(em?.textContent).toBe("italic text");
    expect(em?.className).toContain("italic");
  });

  it("renders inline code with inline styling (not the block style)", () => {
    const { container } = render(<Markdown>{"Use `inline()` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.textContent).toBe("inline()");
    expect(code?.className).toContain("px-1");
    expect(code?.className).not.toContain("block");
  });

  it("renders a fenced code block with block styling", () => {
    const { container } = render(
      <Markdown>{"```js\nconst x = 1;\n```"}</Markdown>,
    );
    const code = container.querySelector("code");
    expect(code?.className).toContain("block");
    expect(code?.textContent).toContain("const x = 1;");
    const pre = container.querySelector("pre");
    expect(pre?.className).toContain("my-2");
  });

  it("renders links opening in a new tab with rel=noreferrer noopener", () => {
    const { container } = render(
      <Markdown>{"[click here](https://example.com)"}</Markdown>,
    );
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noreferrer noopener");
    expect(a?.textContent).toBe("click here");
  });

  it("renders h1-h4 headings with the expected sizing classes", () => {
    const { container } = render(
      <Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>,
    );
    expect(container.querySelector("h1")?.className).toContain("text-sm");
    expect(container.querySelector("h2")?.className).toContain("text-sm");
    expect(container.querySelector("h3")?.className).toContain("text-xs");
    expect(container.querySelector("h4")?.className).toContain("text-xs");
  });

  it("renders a blockquote", () => {
    const { container } = render(<Markdown>{"> A quote"}</Markdown>);
    const bq = container.querySelector("blockquote");
    expect(bq?.textContent?.trim()).toBe("A quote");
    expect(bq?.className).toContain("border-l-2");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"---"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with styled th/td cells (remark-gfm)", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{md}</Markdown>);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const th = container.querySelector("th");
    expect(th?.textContent).toBe("A");
    expect(th?.className).toContain("border");
    const td = container.querySelector("td");
    expect(td?.textContent).toBe("1");
    expect(td?.className).toContain("align-top");
  });

  it("wraps output in a div with the text-text-secondary base class and merges a custom className", () => {
    const { container } = render(<Markdown className="extra-class">{"text"}</Markdown>);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("text-text-secondary");
    expect(wrapper.className).toContain("extra-class");
  });
});
