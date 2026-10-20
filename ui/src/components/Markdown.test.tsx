import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph with the custom paragraph styling", () => {
    const { container } = render(<Markdown>{"Hello world"}</Markdown>);
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p!.textContent).toBe("Hello world");
    expect(p!.className).toContain("mb-2");
  });

  it("applies the passed className to the wrapping div", () => {
    const { container } = render(
      <Markdown className="custom-class">{"text"}</Markdown>,
    );
    const wrapper = container.firstChild as HTMLDivElement;
    expect(wrapper.className).toContain("text-text-secondary");
    expect(wrapper.className).toContain("custom-class");
  });

  it("renders an unordered list with custom list/item styling", () => {
    const { container } = render(<Markdown>{"- one\n- two"}</Markdown>);
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul!.className).toContain("list-disc");
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("one");
    expect(items[0].className).toContain("leading-relaxed");
  });

  it("renders an ordered list with custom styling", () => {
    const { container } = render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol!.className).toContain("list-decimal");
    expect(container.querySelectorAll("li").length).toBe(2);
  });

  it("renders bold and italic text with custom classes", () => {
    const { container } = render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const strong = container.querySelector("strong");
    const em = container.querySelector("em");
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe("bold");
    expect(strong!.className).toContain("font-semibold");
    expect(em).not.toBeNull();
    expect(em!.textContent).toBe("italic");
    expect(em!.className).toContain("italic");
  });

  it("renders inline code without the block styling", () => {
    const { container } = render(<Markdown>{"use `inline()` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("inline()");
    expect(code!.className).not.toContain("block");
    expect(code!.className).toContain("rounded");
  });

  it("renders a fenced code block with the block styling inside <pre>", () => {
    const { container } = render(
      <Markdown>{"```js\nconst x = 1;\n```"}</Markdown>,
    );
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.className).toContain("my-2");
    const code = pre!.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.className).toContain("block");
    expect(code!.textContent).toContain("const x = 1;");
  });

  it("renders a link with target=_blank and rel=noreferrer noopener", () => {
    const { container } = render(
      <Markdown>{"[click here](https://example.com)"}</Markdown>,
    );
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://example.com");
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")).toBe("noreferrer noopener");
    expect(link!.textContent).toBe("click here");
  });

  it("renders h1-h4 headings with their respective custom classes", () => {
    const { container } = render(
      <Markdown>{"# One\n\n## Two\n\n### Three\n\n#### Four"}</Markdown>,
    );
    const h1 = container.querySelector("h1");
    const h2 = container.querySelector("h2");
    const h3 = container.querySelector("h3");
    const h4 = container.querySelector("h4");
    expect(h1?.textContent).toBe("One");
    expect(h1?.className).toContain("text-sm");
    expect(h2?.textContent).toBe("Two");
    expect(h3?.textContent).toBe("Three");
    expect(h3?.className).toContain("text-xs");
    expect(h4?.textContent).toBe("Four");
  });

  it("renders a blockquote with custom border/text styling", () => {
    const { container } = render(<Markdown>{"> quoted text"}</Markdown>);
    const bq = container.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq!.textContent?.trim()).toBe("quoted text");
    expect(bq!.className).toContain("border-l-2");
  });

  it("renders a horizontal rule with custom styling", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    const hr = container.querySelector("hr");
    expect(hr).not.toBeNull();
    expect(hr!.className).toContain("border-border-subtle");
  });

  it("renders a GFM table wrapped in a scroll container, with styled th/td", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{md}</Markdown>);
    const scrollWrap = container.querySelector("div.overflow-x-auto");
    expect(scrollWrap).not.toBeNull();
    const table = scrollWrap!.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.className).toContain("border-collapse");
    const th = container.querySelector("th");
    const td = container.querySelector("td");
    expect(th?.textContent).toBe("A");
    expect(th?.className).toContain("font-semibold");
    expect(td?.textContent).toBe("1");
    expect(td?.className).toContain("align-top");
  });

  it("renders nothing visible for empty markdown input", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.querySelector("p,ul,ol,table")).toBeNull();
  });
});
