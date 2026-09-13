import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain text wrapped in a paragraph", () => {
    const { container } = render(<Markdown>Just plain text</Markdown>);
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p?.textContent).toBe("Just plain text");
    expect(p?.className).toContain("mb-2");
  });

  it("renders an empty string without throwing and produces no paragraph", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.querySelector("p")).toBeNull();
    // outer wrapper div still renders
    expect(container.firstChild).not.toBeNull();
  });

  it("applies the passed className plus default text color class to the wrapper", () => {
    const { container } = render(
      <Markdown className="custom-class">hello</Markdown>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("custom-class");
    expect(wrapper.className).toContain("text-text-secondary");
  });

  it("renders bold text with strong tag and expected styling", () => {
    render(<Markdown>**bold text**</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-semibold");
  });

  it("renders italic text with em tag", () => {
    render(<Markdown>_italic text_</Markdown>);
    const em = screen.getByText("italic text");
    expect(em.tagName).toBe("EM");
    expect(em.className).toContain("italic");
  });

  it("renders unordered lists with li items", () => {
    const md = "- one\n- two\n- three";
    const { container } = render(<Markdown>{md}</Markdown>);
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul?.className).toContain("list-disc");
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe("one");
    expect(items[0].className).toContain("leading-relaxed");
  });

  it("renders ordered lists with ol tag", () => {
    const md = "1. first\n2. second";
    const { container } = render(<Markdown>{md}</Markdown>);
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol?.className).toContain("list-decimal");
    expect(container.querySelectorAll("li").length).toBe(2);
  });

  it("renders inline code with inline styling (no language- class)", () => {
    const { container } = render(<Markdown>{"Use `const x = 1` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("const x = 1");
    expect(code?.className).toContain("rounded");
    expect(code?.className).not.toContain("block");
  });

  it("renders fenced code blocks with block styling and a pre wrapper", () => {
    const md = "```js\nconst x = 1;\n```";
    const { container } = render(<Markdown>{md}</Markdown>);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.className).toContain("my-2");
    const code = pre?.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.className).toContain("block");
    expect(code?.className).toContain("whitespace-pre");
    expect(code?.textContent).toBe("const x = 1;\n");
  });

  it("renders links opening in a new tab with safe rel attributes", () => {
    render(<Markdown>{"[Anthropic](https://anthropic.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "Anthropic" });
    expect(link.getAttribute("href")).toBe("https://anthropic.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
    expect(link.className).toContain("underline");
  });

  it("renders headings h1-h4 with expected tag names", () => {
    const md = "# H1\n\n## H2\n\n### H3\n\n#### H4";
    const { container } = render(<Markdown>{md}</Markdown>);
    expect(container.querySelector("h1")?.textContent).toBe("H1");
    expect(container.querySelector("h2")?.textContent).toBe("H2");
    expect(container.querySelector("h3")?.textContent).toBe("H3");
    expect(container.querySelector("h4")?.textContent).toBe("H4");
    expect(container.querySelector("h1")?.className).toContain("font-semibold");
  });

  it("renders blockquotes with left border styling", () => {
    const { container } = render(<Markdown>{"> a quote"}</Markdown>);
    const bq = container.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq?.textContent).toContain("a quote");
    expect(bq?.className).toContain("border-l-2");
  });

  it("renders a horizontal rule", () => {
    const md = "one\n\n---\n\ntwo";
    const { container } = render(<Markdown>{md}</Markdown>);
    const hr = container.querySelector("hr");
    expect(hr).not.toBeNull();
    expect(hr?.className).toContain("border-border-subtle");
  });

  it("renders GFM tables (via remark-gfm) with th/td styling", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{md}</Markdown>);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    // wrapped in overflow-x-auto div
    expect(table?.parentElement?.className).toContain("overflow-x-auto");
    const th = container.querySelectorAll("th");
    expect(th.length).toBe(2);
    expect(th[0].textContent).toBe("A");
    expect(th[0].className).toContain("font-semibold");
    const td = container.querySelectorAll("td");
    expect(td.length).toBe(2);
    expect(td[0].textContent).toBe("1");
    expect(td[0].className).toContain("align-top");
  });

  it("renders GFM strikethrough and task-list checkboxes without crashing", () => {
    const md = "~~struck~~\n\n- [x] done\n- [ ] todo";
    const { container } = render(<Markdown>{md}</Markdown>);
    expect(container.textContent).toContain("struck");
    expect(container.textContent).toContain("done");
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(2);
  });
});
