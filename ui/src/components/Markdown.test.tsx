import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a paragraph", () => {
    render(<Markdown>{"Hello world"}</Markdown>);
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("renders an unordered list with items", () => {
    const { container } = render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(container.querySelector("ul")).not.toBeNull();
    expect(screen.getByText("one")).toBeDefined();
    expect(screen.getByText("two")).toBeDefined();
  });

  it("renders an ordered list with items", () => {
    const { container } = render(<Markdown>{"1. first\n2. second"}</Markdown>);
    expect(container.querySelector("ol")).not.toBeNull();
    expect(screen.getByText("first")).toBeDefined();
  });

  it("renders bold and italic text", () => {
    const { container } = render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
  });

  it("renders inline code without the block styling", () => {
    const { container } = render(<Markdown>{"use `inline()` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.className).not.toContain("block");
    expect(code?.textContent).toBe("inline()");
  });

  it("renders a fenced code block with block styling", () => {
    const { container } = render(
      <Markdown>{"```js\nconst a = 1;\n```"}</Markdown>,
    );
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.className).toContain("block");
    expect(container.querySelector("pre")).not.toBeNull();
  });

  it("renders a link that opens in a new tab", () => {
    render(<Markdown>{"[click me](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click me" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders headings h1 through h4", () => {
    const { container } = render(
      <Markdown>{"# H1\n## H2\n### H3\n#### H4"}</Markdown>,
    );
    expect(container.querySelector("h1")?.textContent).toBe("H1");
    expect(container.querySelector("h2")?.textContent).toBe("H2");
    expect(container.querySelector("h3")?.textContent).toBe("H3");
    expect(container.querySelector("h4")?.textContent).toBe("H4");
  });

  it("renders a blockquote", () => {
    const { container } = render(<Markdown>{"> quoted text"}</Markdown>);
    expect(container.querySelector("blockquote")?.textContent?.trim()).toBe(
      "quoted text",
    );
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"---"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with header and data cells", () => {
    const { container } = render(
      <Markdown>
        {"| A | B |\n| --- | --- |\n| 1 | 2 |"}
      </Markdown>,
    );
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("th")?.textContent).toBe("A");
    expect(container.querySelector("td")?.textContent).toBe("1");
  });

  it("applies the custom className to the wrapper div", () => {
    const { container } = render(
      <Markdown className="extra-class">{"text"}</Markdown>,
    );
    expect(container.firstChild).not.toBeNull();
    expect((container.firstChild as HTMLElement).className).toContain(
      "extra-class",
    );
  });
});
