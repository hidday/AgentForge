import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph", () => {
    const { container } = render(<Markdown>{"Hello world"}</Markdown>);
    expect(container.querySelector("p")?.textContent).toBe("Hello world");
  });

  it("renders an unordered list with its custom classes", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one")).toBeDefined();
    expect(screen.getByText("two")).toBeDefined();
    const list = screen.getByText("one").closest("ul");
    expect(list?.className).toContain("list-disc");
  });

  it("renders an ordered list with its custom classes", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByText("first").closest("ol");
    expect(list?.className).toContain("list-decimal");
  });

  it("renders bold text with the semibold class", () => {
    render(<Markdown>{"**bold text**"}</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-semibold");
  });

  it("renders italic text", () => {
    render(<Markdown>{"*italic text*"}</Markdown>);
    expect(screen.getByText("italic text").tagName).toBe("EM");
  });

  it("renders inline code without the block styling", () => {
    render(<Markdown>{"Use `cn()` helper"}</Markdown>);
    const code = screen.getByText("cn()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders a fenced code block with the block styling", () => {
    const { container } = render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.className).toContain("block");
  });

  it("renders links opening in a new tab with rel=noreferrer noopener", () => {
    render(<Markdown>{"[click me](https://example.com)"}</Markdown>);
    const link = screen.getByText("click me").closest("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders h1-h4 headings with their custom size classes", () => {
    const { container } = render(
      <Markdown>{"# H1\n\n## H2\n\n### H3\n\n#### H4"}</Markdown>,
    );
    expect(container.querySelector("h1")?.className).toContain("text-sm");
    expect(container.querySelector("h2")?.className).toContain("text-sm");
    expect(container.querySelector("h3")?.className).toContain("text-xs");
    expect(container.querySelector("h4")?.className).toContain("text-xs");
  });

  it("renders a blockquote with the muted border styling", () => {
    const { container } = render(<Markdown>{"> a quote"}</Markdown>);
    const bq = container.querySelector("blockquote");
    expect(bq?.textContent).toContain("a quote");
    expect(bq?.className).toContain("border-l-2");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"before\n\n---\n\nafter"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with th/td custom classes", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{md}</Markdown>);
    const th = container.querySelector("th");
    const td = container.querySelector("td");
    expect(th?.className).toContain("border-border-subtle");
    expect(td?.className).toContain("align-top");
    expect(container.querySelector("table")?.closest("div")?.className).toContain(
      "overflow-x-auto",
    );
  });

  it("applies a custom className to the wrapper div", () => {
    const { container } = render(<Markdown className="extra-class">{"text"}</Markdown>);
    expect(container.firstElementChild?.className).toContain("extra-class");
  });
});
