import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph", () => {
    const { container } = render(<Markdown>{"Hello world"}</Markdown>);
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p?.textContent).toBe("Hello world");
    expect(p?.className).toContain("mb-2");
  });

  it("renders an unordered list with items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["one", "two"]);
  });

  it("renders an ordered list with items", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["first", "second"]);
  });

  it("renders bold text as a styled <strong>", () => {
    const { container } = render(<Markdown>{"**bold text**"}</Markdown>);
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("bold text");
    expect(strong?.className).toContain("font-semibold");
  });

  it("renders italic text as a styled <em>", () => {
    const { container } = render(<Markdown>{"*italic text*"}</Markdown>);
    const em = container.querySelector("em");
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe("italic text");
    expect(em?.className).toContain("italic");
  });

  it("renders a link that opens in a new tab safely", () => {
    render(<Markdown>{"[click here](https://example.com/page)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com/page");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders an h1 heading", () => {
    render(<Markdown>{"# Big Title"}</Markdown>);
    const heading = screen.getByRole("heading", { level: 1, name: "Big Title" });
    expect(heading.tagName).toBe("H1");
    expect(heading.className).toContain("font-semibold");
  });

  it("renders an h2 heading", () => {
    render(<Markdown>{"## Section Title"}</Markdown>);
    const heading = screen.getByRole("heading", { level: 2, name: "Section Title" });
    expect(heading.tagName).toBe("H2");
    expect(heading.className).toContain("font-semibold");
  });

  it("renders an h3 heading", () => {
    render(<Markdown>{"### Sub Title"}</Markdown>);
    const heading = screen.getByRole("heading", { level: 3, name: "Sub Title" });
    expect(heading.tagName).toBe("H3");
    expect(heading.className).toContain("font-semibold");
  });

  it("renders an h4 heading", () => {
    render(<Markdown>{"#### Minor Title"}</Markdown>);
    const heading = screen.getByRole("heading", { level: 4, name: "Minor Title" });
    expect(heading.tagName).toBe("H4");
    expect(heading.className).toContain("font-semibold");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    const hr = container.querySelector("hr");
    expect(hr).not.toBeNull();
    expect(hr?.className).toContain("border-border-subtle");
  });

  it("renders a blockquote", () => {
    const { container } = render(<Markdown>{"> a quoted line"}</Markdown>);
    const quote = container.querySelector("blockquote");
    expect(quote).not.toBeNull();
    expect(quote?.textContent?.trim()).toBe("a quoted line");
    expect(quote?.className).toContain("border-l-2");
  });

  it("renders a GFM table with headers and cells", () => {
    const md = "| Name | Score |\n| --- | --- |\n| Alice | 10 |";
    render(<Markdown>{md}</Markdown>);

    const table = screen.getByRole("table");
    expect(table).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Score" })).toBeDefined();
    expect(screen.getByRole("cell", { name: "Alice" })).toBeDefined();
    expect(screen.getByRole("cell", { name: "10" })).toBeDefined();
  });

  it("renders a fenced code block with the block styling class", () => {
    const md = "```js\nconst a = 1;\n```";
    const { container } = render(<Markdown>{md}</Markdown>);

    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("const a = 1;\n");
    expect(code?.className).toContain("block");
    expect(code?.className).toContain("whitespace-pre");
  });

  it("renders inline code without the block styling class", () => {
    const md = "Use the `inline` value here";
    const { container } = render(<Markdown>{md}</Markdown>);

    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("inline");
    expect(code?.className).not.toContain("block");
    expect(code?.className).toContain("px-1");
  });

  it("merges a passed className onto the wrapping element", () => {
    const { container } = render(
      <Markdown className="my-extra-class">{"text"}</Markdown>,
    );
    expect(container.firstElementChild?.className).toContain("my-extra-class");
  });
});
