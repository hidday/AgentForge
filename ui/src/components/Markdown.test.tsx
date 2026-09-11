import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders headings h1-h4", () => {
    render(<Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>);

    expect(screen.getByRole("heading", { level: 1, name: "H1" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "H2" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 3, name: "H3" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 4, name: "H4" })).toBeDefined();
  });

  it("renders a paragraph with correct classes", () => {
    const { container } = render(<Markdown>{"Just a paragraph."}</Markdown>);
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p?.textContent).toBe("Just a paragraph.");
    expect(p?.className).toContain("mb-2");
  });

  it("renders an unordered list with items", () => {
    render(<Markdown>{"- one\n- two\n- three"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toBe("one");
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
  });

  it("renders bold and italic text", () => {
    const { container } = render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const strong = container.querySelector("strong");
    const em = container.querySelector("em");
    expect(strong?.textContent).toBe("bold");
    expect(strong?.className).toContain("font-semibold");
    expect(em?.textContent).toBe("italic");
  });

  it("renders inline code without block styling", () => {
    const { container } = render(<Markdown>{"use `inline()` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.textContent).toBe("inline()");
    expect(code?.className).not.toContain("block");
  });

  it("renders fenced code blocks with block styling wrapped in pre", () => {
    const { container } = render(
      <Markdown>{"```js\nconst x = 1;\n```"}</Markdown>,
    );
    const pre = container.querySelector("pre");
    const code = container.querySelector("code");
    expect(pre).not.toBeNull();
    expect(code?.className).toContain("block");
    expect(code?.textContent).toContain("const x = 1;");
  });

  it("renders links opening in a new tab with rel=noreferrer noopener", () => {
    render(<Markdown>{"[Anthropic](https://anthropic.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "Anthropic" });
    expect(link.getAttribute("href")).toBe("https://anthropic.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders blockquotes and horizontal rules", () => {
    const { container } = render(
      <Markdown>{"> quoted text\n\n---\n\nafter"}</Markdown>,
    );
    const blockquote = container.querySelector("blockquote");
    expect(blockquote?.textContent).toContain("quoted text");
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders GFM tables via remark-gfm", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{md}</Markdown>);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const th = container.querySelectorAll("th");
    expect(th).toHaveLength(2);
    expect(th[0].textContent).toBe("A");
    const td = container.querySelectorAll("td");
    expect(td[0].textContent).toBe("1");
  });

  it("applies the passed className to the wrapper div", () => {
    const { container } = render(
      <Markdown className="custom-class">{"text"}</Markdown>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("custom-class");
    expect(wrapper?.className).toContain("text-text-secondary");
  });
});
