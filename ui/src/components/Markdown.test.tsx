import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain text as a paragraph", () => {
    const { container } = render(<Markdown>Hello world</Markdown>);
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p!.textContent).toBe("Hello world");
    expect(p!.className).toContain("mb-2");
  });

  it("renders a heading with the custom h2 styling", () => {
    render(<Markdown>{"## Section Title"}</Markdown>);
    const heading = screen.getByText("Section Title");
    expect(heading.tagName).toBe("H2");
    expect(heading.className).toContain("font-semibold");
  });

  it("renders a fenced code block as a block-level <code> with language class handling", () => {
    const markdown = "```js\nconst x = 1;\n```";
    const { container } = render(<Markdown>{markdown}</Markdown>);
    const code = container.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toContain("const x = 1;");
    expect(code!.className).toContain("block");
    expect(code!.className).toContain("whitespace-pre");
  });

  it("renders inline code distinctly from a block", () => {
    const { container } = render(<Markdown>{"Use `foo()` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("foo()");
    expect(code!.className).not.toContain("block");
    expect(code!.className).toContain("px-1");
  });

  it("renders an unordered list with its items", () => {
    const markdown = "- one\n- two\n- three";
    const { container } = render(<Markdown>{markdown}</Markdown>);
    const list = container.querySelector("ul");
    expect(list).not.toBeNull();
    expect(list!.className).toContain("list-disc");
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toBe("one");
    expect(items[2].textContent).toBe("three");
  });

  it("renders an ordered list with the decimal list style", () => {
    const markdown = "1. first\n2. second";
    const { container } = render(<Markdown>{markdown}</Markdown>);
    const list = container.querySelector("ol");
    expect(list).not.toBeNull();
    expect(list!.className).toContain("list-decimal");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders a link that opens in a new tab safely", () => {
    const markdown = "[docs](https://example.com/docs)";
    render(<Markdown>{markdown}</Markdown>);
    const link = screen.getByText("docs") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("applies the wrapper className alongside the base text color class", () => {
    const { container } = render(
      <Markdown className="custom-class">Hi</Markdown>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("custom-class");
    expect(wrapper.className).toContain("text-text-secondary");
  });

  it("renders bold and italic text with custom styling", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    const strong = screen.getByText("bold");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-semibold");

    const em = screen.getByText("italic");
    expect(em.tagName).toBe("EM");
    expect(em.className).toContain("italic");
  });
});
