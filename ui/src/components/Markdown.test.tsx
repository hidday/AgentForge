import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders paragraph text", () => {
    render(<Markdown>{"Hello world"}</Markdown>);
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("renders bold text inside a strong tag", () => {
    render(<Markdown>{"**bold text**"}</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renders a bullet list as a ul > li structure", () => {
    const { container } = render(<Markdown>{"- one\n- two"}</Markdown>);
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(container.querySelectorAll("li").length).toBe(2);
  });

  it("renders fenced code blocks as a block-styled code element", () => {
    const { container } = render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.className).toContain("block");
    expect(code?.textContent).toContain("const x = 1;");
  });

  it("renders inline code without the block styling", () => {
    const { container } = render(<Markdown>{"use `npm install`"}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.className).not.toContain("block");
    expect(code?.textContent).toBe("npm install");
  });

  it("renders links opening in a new tab with rel=noreferrer noopener", () => {
    render(<Markdown>{"[click me](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click me" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders a GFM table (remark-gfm) with th/td cells", () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{table}</Markdown>);
    expect(container.querySelectorAll("th").length).toBe(2);
    expect(container.querySelectorAll("td").length).toBe(2);
  });

  it("applies the passed className to the wrapper div", () => {
    const { container } = render(<Markdown className="my-class">{"text"}</Markdown>);
    expect(container.querySelector("div.my-class")).not.toBeNull();
  });

  it("renders nothing visible for an empty string", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.textContent).toBe("");
  });
});
