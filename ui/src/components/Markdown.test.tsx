import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders empty content without crashing and produces no visible text", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.textContent).toBe("");
  });

  it("renders headings h1-h4", () => {
    render(<Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>);
    expect(screen.getByRole("heading", { level: 1, name: "H1" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "H2" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 3, name: "H3" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 4, name: "H4" })).toBeDefined();
  });

  it("renders paragraphs", () => {
    const { container } = render(<Markdown>{"Hello world"}</Markdown>);
    const p = container.querySelector("p");
    expect(p?.textContent).toBe("Hello world");
    expect(p?.className).toContain("mb-2");
  });

  it("renders unordered lists with list items", () => {
    render(<Markdown>{"- one\n- two\n- three"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    const items = screen.getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(["one", "two", "three"]);
  });

  it("renders ordered lists", () => {
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

  it("renders inline code with inline styling", () => {
    const { container } = render(<Markdown>{"Use `npm install` to set up"}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.textContent).toBe("npm install");
    expect(code?.className).not.toContain("block");
  });

  it("renders fenced code blocks with block styling", () => {
    const { container } = render(
      <Markdown>{"```js\nconst x = 1;\n```"}</Markdown>,
    );
    const code = container.querySelector("code");
    expect(code?.className).toContain("block");
    expect(code?.textContent).toContain("const x = 1;");
    expect(container.querySelector("pre")).not.toBeNull();
  });

  it("renders links that open in a new tab safely", () => {
    render(<Markdown>{"[AgentForge](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "AgentForge" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders blockquotes and horizontal rules", () => {
    const { container } = render(
      <Markdown>{"> quoted text\n\n---\n\nafter"}</Markdown>,
    );
    expect(container.querySelector("blockquote")?.textContent).toContain("quoted text");
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders GFM tables via remark-gfm", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    render(<Markdown>{md}</Markdown>);
    const table = screen.getByRole("table");
    expect(table).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "A" })).toBeDefined();
    expect(screen.getByRole("cell", { name: "1" })).toBeDefined();
  });

  it("applies a custom className to the wrapper div", () => {
    const { container } = render(
      <Markdown className="custom-wrap">{"text"}</Markdown>,
    );
    expect(container.firstElementChild?.className).toContain("custom-wrap");
    expect(container.firstElementChild?.className).toContain("text-text-secondary");
  });
});
