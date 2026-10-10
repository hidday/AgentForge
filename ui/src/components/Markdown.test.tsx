import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("wraps the rendered markdown in a div carrying the base text class and an optional custom className", () => {
    const { container } = render(
      <Markdown className="extra-class">hello</Markdown>,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper.className).toContain("text-text-secondary");
    expect(wrapper.className).toContain("extra-class");
  });

  it("renders a paragraph with the expected spacing class", () => {
    const { container } = render(<Markdown>{"just a paragraph"}</Markdown>);
    const p = container.querySelector("p");
    expect(p).toBeDefined();
    expect(p!.textContent).toBe("just a paragraph");
    expect(p!.className).toContain("mb-2");
  });

  it("renders h1-h4 headings with the right tag and size classes", () => {
    render(
      <Markdown>{"# Heading One\n\n## Heading Two\n\n### Heading Three\n\n#### Heading Four"}</Markdown>,
    );

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Heading One");
    expect(h1.className).toContain("text-sm");

    const h2 = screen.getByRole("heading", { level: 2 });
    expect(h2.textContent).toBe("Heading Two");
    expect(h2.className).toContain("text-sm");

    const h3 = screen.getByRole("heading", { level: 3 });
    expect(h3.textContent).toBe("Heading Three");
    expect(h3.className).toContain("text-xs");

    const h4 = screen.getByRole("heading", { level: 4 });
    expect(h4.textContent).toBe("Heading Four");
    expect(h4.className).toContain("text-xs");
  });

  it("renders a link that opens in a new tab with safe rel attributes", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByText("click here") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders a fenced code block with language info as a block-styled code element", () => {
    const { container } = render(
      <Markdown>{"```js\nconst a = 1;\n```"}</Markdown>,
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeDefined();
    expect(pre!.className).toContain("my-2");

    const code = pre!.querySelector("code");
    expect(code).toBeDefined();
    expect(code!.textContent).toContain("const a = 1;");
    expect(code!.className).toContain("block");
    expect(code!.className).toContain("overflow-x-auto");
  });

  it("renders inline code distinctly from a fenced code block", () => {
    const { container } = render(<Markdown>{"some `inline` code"}</Markdown>);
    const code = container.querySelector("code");
    expect(code).toBeDefined();
    expect(code!.textContent).toBe("inline");
    expect(code!.className).not.toContain("block");
    expect(code!.className).toContain("px-1");
  });

  it("renders an unordered list with styled items", () => {
    const { container } = render(<Markdown>{"- first\n- second"}</Markdown>);
    const ul = container.querySelector("ul");
    expect(ul).toBeDefined();
    expect(ul!.className).toContain("list-disc");
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("first");
    expect(items[1].textContent).toBe("second");
  });

  it("renders an ordered list with styled items", () => {
    const { container } = render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const ol = container.querySelector("ol");
    expect(ol).toBeDefined();
    expect(ol!.className).toContain("list-decimal");
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
  });

  it("renders strong and emphasis text with the right tags", () => {
    const { container } = render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const strong = container.querySelector("strong");
    const em = container.querySelector("em");
    expect(strong).toBeDefined();
    expect(strong!.textContent).toBe("bold");
    expect(strong!.className).toContain("font-semibold");
    expect(em).toBeDefined();
    expect(em!.textContent).toBe("italic");
    expect(em!.className).toContain("italic");
  });

  it("renders a blockquote with the expected border class", () => {
    const { container } = render(<Markdown>{"> a wise quote"}</Markdown>);
    const blockquote = container.querySelector("blockquote");
    expect(blockquote).toBeDefined();
    expect(blockquote!.textContent).toContain("a wise quote");
    expect(blockquote!.className).toContain("border-l-2");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    const hr = container.querySelector("hr");
    expect(hr).toBeDefined();
    expect(hr!.className).toContain("border-border-subtle");
  });

  it("renders a GFM table with th and td cells", () => {
    const markdown = "| Name | Value |\n| --- | --- |\n| a | 1 |\n| b | 2 |";
    const { container } = render(<Markdown>{markdown}</Markdown>);

    const table = container.querySelector("table");
    expect(table).toBeDefined();
    expect(table!.className).toContain("border-collapse");

    const ths = container.querySelectorAll("th");
    expect(ths.length).toBe(2);
    expect(ths[0].textContent).toBe("Name");
    expect(ths[0].className).toContain("font-semibold");

    const tds = container.querySelectorAll("td");
    expect(tds.length).toBe(4);
    expect(tds[0].textContent).toBe("a");
    expect(tds[0].className).toContain("align-top");

    const tableWrapper = container.querySelector(".overflow-x-auto");
    expect(tableWrapper).toBeDefined();
  });
});
