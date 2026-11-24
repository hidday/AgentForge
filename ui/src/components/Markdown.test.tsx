import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain text content", () => {
    render(<Markdown>{"Hello world"}</Markdown>);
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("renders bold text using the strong component override", () => {
    render(<Markdown>{"**bold text**"}</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-semibold");
  });

  it("renders a bullet list using the custom ul/li overrides", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one").tagName).toBe("LI");
    expect(screen.getByText("two").tagName).toBe("LI");
  });

  it("renders fenced code blocks with the block styling branch", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText(/const x = 1;/);
    expect(code.className).toContain("block");
  });

  it("renders inline code with the inline styling branch", () => {
    render(<Markdown>{"Use `cn()` to merge classes"}</Markdown>);
    const code = screen.getByText("cn()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders links that open in a new tab with safe rel attributes", () => {
    render(<Markdown>{"[docs](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "docs" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("applies a custom className to the wrapper", () => {
    const { container } = render(<Markdown className="extra">{"text"}</Markdown>);
    expect(container.firstChild).toHaveProperty("className", expect.stringContaining("extra"));
  });

  it("renders an ordered list using the custom ol/li overrides", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const first = screen.getByText("first");
    expect(first.tagName).toBe("LI");
    expect(first.closest("ol")).not.toBeNull();
  });

  it("renders italic text using the em component override", () => {
    render(<Markdown>{"*italic text*"}</Markdown>);
    const em = screen.getByText("italic text");
    expect(em.tagName).toBe("EM");
    expect(em.className).toContain("italic");
  });

  it("wraps a fenced code block in the custom pre override", () => {
    const { container } = render(<Markdown>{"```\ncode\n```"}</Markdown>);
    expect(container.querySelector("pre.my-2")).not.toBeNull();
  });

  it("renders headings h1 through h4 with the custom size classes", () => {
    render(<Markdown>{"# H1\n## H2\n### H3\n#### H4"}</Markdown>);
    expect(screen.getByText("H1").tagName).toBe("H1");
    expect(screen.getByText("H2").tagName).toBe("H2");
    expect(screen.getByText("H3").tagName).toBe("H3");
    expect(screen.getByText("H4").tagName).toBe("H4");
  });

  it("renders a blockquote with the muted border styling", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    const quote = screen.getByText("quoted text").closest("blockquote");
    expect(quote).not.toBeNull();
    expect(quote?.className).toContain("border-l-2");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table via remark-gfm", () => {
    const table = "| A | B |\n| - | - |\n| 1 | 2 |";
    render(<Markdown>{table}</Markdown>);
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });
});
