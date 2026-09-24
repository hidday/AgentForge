import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph with the expected styling classes", () => {
    const { container } = render(<Markdown>{"Hello world"}</Markdown>);
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p?.textContent).toBe("Hello world");
    expect(p?.className).toContain("mb-2");
  });

  it("renders an unordered list with styled list items", () => {
    const { container } = render(<Markdown>{"- one\n- two"}</Markdown>);
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul?.className).toContain("list-disc");
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("one");
  });

  it("renders an ordered list with decimal styling", () => {
    const { container } = render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol?.className).toContain("list-decimal");
  });

  it("renders bold and italic text", () => {
    const { container } = render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const strong = container.querySelector("strong");
    const em = container.querySelector("em");
    expect(strong?.textContent).toBe("bold");
    expect(strong?.className).toContain("font-semibold");
    expect(em?.textContent).toBe("italic");
    expect(em?.className).toContain("italic");
  });

  it("renders inline code with inline styling (no language class)", () => {
    const { container } = render(<Markdown>{"Use `const x = 1` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.textContent).toBe("const x = 1");
    expect(code?.className).toContain("rounded bg-surface-subtle/60 border border-border-subtle px-1 py-0.5");
  });

  it("renders fenced code blocks with block styling inside a pre", () => {
    const { container } = render(
      <Markdown>{"```js\nconst x = 1;\n```"}</Markdown>,
    );
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    const code = pre?.querySelector("code");
    expect(code?.className).toContain("block rounded");
    expect(code?.textContent).toContain("const x = 1;");
  });

  it("renders links opening in a new tab with rel=noreferrer noopener", () => {
    render(<Markdown>{"[Anthropic](https://anthropic.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "Anthropic" });
    expect(link.getAttribute("href")).toBe("https://anthropic.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
    expect(link.className).toContain("text-accent");
  });

  it("renders headings h1 through h4 with matching sizes", () => {
    const { container } = render(
      <Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>,
    );
    expect(container.querySelector("h1")?.textContent).toBe("H1");
    expect(container.querySelector("h2")?.textContent).toBe("H2");
    expect(container.querySelector("h3")?.textContent).toBe("H3");
    expect(container.querySelector("h4")?.textContent).toBe("H4");
    expect(container.querySelector("h1")?.className).toContain("text-sm");
    expect(container.querySelector("h3")?.className).toContain("text-xs");
  });

  it("renders a blockquote with the muted border styling", () => {
    const { container } = render(<Markdown>{"> A quoted note"}</Markdown>);
    const bq = container.querySelector("blockquote");
    expect(bq?.textContent).toContain("A quoted note");
    expect(bq?.className).toContain("border-l-2");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders GFM tables via remark-gfm with styled cells", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{md}</Markdown>);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const ths = container.querySelectorAll("th");
    expect(ths.length).toBe(2);
    expect(ths[0].textContent).toBe("A");
    expect(ths[0].className).toContain("border");
    const tds = container.querySelectorAll("td");
    expect(tds.length).toBe(2);
    expect(tds[0].textContent).toBe("1");
  });

  it("applies an additional className to the wrapping div", () => {
    const { container } = render(
      <Markdown className="extra-class">{"text"}</Markdown>,
    );
    expect(container.firstElementChild?.className).toContain("extra-class");
    expect(container.firstElementChild?.className).toContain("text-text-secondary");
  });
});
