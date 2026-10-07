import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders an empty string without crashing", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.querySelector("div")).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders bold text with semibold styling", () => {
    render(<Markdown>{"**important**"}</Markdown>);
    const strong = screen.getByText("important");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-semibold");
  });

  it("renders italic text", () => {
    render(<Markdown>{"*subtle*"}</Markdown>);
    expect(screen.getByText("subtle").tagName).toBe("EM");
  });

  it("renders a link that opens in a new tab safely", () => {
    render(<Markdown>{"[docs](https://example.com/docs)"}</Markdown>);
    const link = screen.getByRole("link", { name: "docs" });
    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("renders an unordered list", () => {
    const { container } = render(<Markdown>{"- one\n- two"}</Markdown>);
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul?.className).toContain("list-disc");
    expect(screen.getByText("one")).toBeDefined();
    expect(screen.getByText("two")).toBeDefined();
  });

  it("renders an ordered list", () => {
    const { container } = render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol?.className).toContain("list-decimal");
  });

  it("renders a fenced code block distinctly from inline code", () => {
    const { container } = render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const blockCode = container.querySelector("pre code");
    expect(blockCode).not.toBeNull();
    expect(blockCode?.className).toContain("block");
    expect(blockCode?.textContent).toContain("const x = 1;");
  });

  it("renders inline code without block styling", () => {
    render(<Markdown>{"Use `npm install` to set up."}</Markdown>);
    const code = screen.getByText("npm install");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders headings of every supported level", () => {
    render(<Markdown>{"# Title\n\n## Subtitle\n\n### Section\n\n#### Subsection"}</Markdown>);
    expect(screen.getByText("Title").tagName).toBe("H1");
    expect(screen.getByText("Subtitle").tagName).toBe("H2");
    expect(screen.getByText("Section").tagName).toBe("H3");
    expect(screen.getByText("Subsection").tagName).toBe("H4");
  });

  it("renders a blockquote", () => {
    const { container } = render(<Markdown>{"> quoted text"}</Markdown>);
    const bq = container.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq?.textContent).toContain("quoted text");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with header and data cells", () => {
    const { container } = render(
      <Markdown>{"| Name | Value |\n| --- | --- |\n| a | 1 |"}</Markdown>,
    );
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByText("Name").tagName).toBe("TH");
    expect(screen.getByText("a").tagName).toBe("TD");
  });

  it("applies the passed-in className to the wrapping element", () => {
    const { container } = render(<Markdown className="custom-class">{"text"}</Markdown>);
    expect(container.querySelector("div.custom-class")).not.toBeNull();
  });
});
