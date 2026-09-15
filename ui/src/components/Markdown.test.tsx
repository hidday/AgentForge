import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph", () => {
    const { container } = render(<Markdown>{"Hello world"}</Markdown>);
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p?.textContent).toBe("Hello world");
    expect(p?.className).toContain("mb-2");
  });

  it("applies the custom className to the wrapper div", () => {
    const { container } = render(
      <Markdown className="custom-class">{"text"}</Markdown>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("custom-class");
    expect(wrapper.className).toContain("text-text-secondary");
  });

  it("renders an unordered list with items", () => {
    const { container } = render(
      <Markdown>{"- one\n- two\n- three"}</Markdown>,
    );
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul?.className).toContain("list-disc");
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toBe("one");
  });

  it("renders an ordered list", () => {
    const { container } = render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol?.className).toContain("list-decimal");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders strong and em text", () => {
    const { container } = render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const strong = container.querySelector("strong");
    const em = container.querySelector("em");
    expect(strong?.textContent).toBe("bold");
    expect(strong?.className).toContain("font-semibold");
    expect(em?.textContent).toBe("italic");
    expect(em?.className).toContain("italic");
  });

  it("renders inline code without block styling", () => {
    const { container } = render(<Markdown>{"here is `inline` code"}</Markdown>);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("inline");
    expect(code?.className).toContain("rounded");
    expect(code?.className).not.toContain("block");
  });

  it("renders fenced code blocks with block styling", () => {
    const { container } = render(
      <Markdown>{"```js\nconst x = 1;\n```"}</Markdown>,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.className).toContain("block");
    expect(code?.className).toContain("whitespace-pre");
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.className).toContain("my-2");
  });

  it("renders links with target=_blank and rel attributes", () => {
    const { container } = render(
      <Markdown>{"[click here](https://example.com)"}</Markdown>,
    );
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noreferrer noopener");
    expect(link?.className).toContain("underline");
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
    const bq = container.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq?.textContent).toContain("quoted text");
    expect(bq?.className).toContain("border-l-2");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"one\n\n---\n\ntwo"}</Markdown>);
    const hr = container.querySelector("hr");
    expect(hr).not.toBeNull();
    expect(hr?.className).toContain("border-border-subtle");
  });

  it("renders GFM tables via remark-gfm with th/td cells", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{md}</Markdown>);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const ths = container.querySelectorAll("th");
    expect(ths).toHaveLength(2);
    expect(ths[0].textContent).toBe("A");
    const tds = container.querySelectorAll("td");
    expect(tds).toHaveLength(2);
    expect(tds[0].textContent).toBe("1");
  });

  it("renders empty string content without throwing", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.firstElementChild).not.toBeNull();
  });
});
