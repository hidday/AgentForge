import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain paragraph text", () => {
    render(<Markdown>Hello world</Markdown>);
    expect(screen.getByText("Hello world").tagName).toBe("P");
  });

  it("renders an h1 heading with the expected tag", () => {
    render(<Markdown>{"# Title"}</Markdown>);
    const heading = screen.getByText("Title");
    expect(heading.tagName).toBe("H1");
  });

  it("renders h2, h3 and h4 headings with the expected tags", () => {
    render(<Markdown>{"## Two\n\n### Three\n\n#### Four"}</Markdown>);
    expect(screen.getByText("Two").tagName).toBe("H2");
    expect(screen.getByText("Three").tagName).toBe("H3");
    expect(screen.getByText("Four").tagName).toBe("H4");
  });

  it("renders an unordered list with its items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    const list = screen.getByText("one").closest("ul");
    expect(list).not.toBeNull();
    expect(screen.getByText("one").tagName).toBe("LI");
    expect(screen.getByText("two").tagName).toBe("LI");
  });

  it("renders an ordered list using an <ol> element", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByText("first").closest("ol");
    expect(list).not.toBeNull();
  });

  it("renders bold text inside a <strong> element", () => {
    render(<Markdown>{"**bold text**"}</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renders italic text inside an <em> element", () => {
    render(<Markdown>{"*italic text*"}</Markdown>);
    const em = screen.getByText("italic text");
    expect(em.tagName).toBe("EM");
  });

  it("renders a fenced code block as a block-style <code> with the language class", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
    expect(code.className).toContain("whitespace-pre");
  });

  it("renders inline code as a non-block <code> without the block class", () => {
    render(<Markdown>{"Use `const x` here"}</Markdown>);
    const code = screen.getByText("const x");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders links with target=_blank and rel=noreferrer noopener", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByText("click here") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders a blockquote using the <blockquote> element", () => {
    render(<Markdown>{"> quoted text"}</Markdown>);
    const quote = screen.getByText("quoted text");
    expect(quote.closest("blockquote")).not.toBeNull();
  });

  it("renders a GFM table via remark-gfm with th/td cells", () => {
    render(
      <Markdown>{"| A | B |\n| --- | --- |\n| 1 | 2 |"}</Markdown>,
    );
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("applies a custom className to the wrapping div", () => {
    const { container } = render(
      <Markdown className="custom-class">Hello</Markdown>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("custom-class");
    expect(wrapper.className).toContain("text-text-secondary");
  });

  it("renders a horizontal rule as an <hr> element", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders an empty string without throwing and without content", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.textContent).toBe("");
  });
});
