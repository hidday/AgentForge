import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders bold and italic text using the custom strong/em components", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const strong = screen.getByText("bold");
    expect(strong.tagName).toBe("STRONG");
    const em = screen.getByText("italic");
    expect(em.tagName).toBe("EM");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one")).toBeDefined();
    expect(screen.getByText("two")).toBeDefined();
    expect(screen.getAllByRole("listitem").length).toBe(2);
  });

  it("renders inline code without the block styling class", () => {
    const { container } = render(<Markdown>{"use `inline()` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.className).not.toContain("block");
  });

  it("renders a fenced code block with the block styling class", () => {
    const { container } = render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.className).toContain("block");
  });

  it("renders links with target=_blank and rel=noreferrer noopener", () => {
    render(<Markdown>{"[click me](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click me" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders a GFM table via remark-gfm", () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    render(<Markdown>{table}</Markdown>);
    expect(screen.getByText("A")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
  });

  it("renders an ordered list using the custom ol component", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(2);
    expect(items[0].closest("ol")).not.toBeNull();
  });

  it("renders all heading levels with their custom components", () => {
    render(<Markdown>{"# H1\n## H2\n### H3\n#### H4"}</Markdown>);
    expect(screen.getByText("H1").tagName).toBe("H1");
    expect(screen.getByText("H2").tagName).toBe("H2");
    expect(screen.getByText("H3").tagName).toBe("H3");
    expect(screen.getByText("H4").tagName).toBe("H4");
  });

  it("renders a blockquote with the custom component", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    expect(screen.getByText("quoted text").closest("blockquote")).not.toBeNull();
  });

  it("renders a horizontal rule with the custom component", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("applies the provided className to the wrapping div", () => {
    const { container } = render(<Markdown className="my-extra-class">text</Markdown>);
    expect(container.firstElementChild?.className).toContain("my-extra-class");
  });
});
