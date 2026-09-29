import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders headings", () => {
    render(
      <Markdown>
        {"# Heading One\n\n## Heading Two\n\n### Heading Three\n\n#### Heading Four"}
      </Markdown>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Heading One" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "Heading Two" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 3, name: "Heading Three" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 4, name: "Heading Four" })).toBeDefined();
  });

  it("renders a blockquote and a horizontal rule", () => {
    const { container } = render(
      <Markdown>{"> A quoted line\n\n---\n\nAfter the rule"}</Markdown>,
    );
    const blockquote = container.querySelector("blockquote");
    expect(blockquote?.textContent).toContain("A quoted line");
    expect(container.querySelector("hr")).not.toBeNull();
    expect(screen.getByText("After the rule")).toBeDefined();
  });

  it("renders a GFM table with header and body cells", () => {
    render(
      <Markdown>
        {"| Name | Value |\n| --- | --- |\n| foo | 1 |"}
      </Markdown>,
    );
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Value" })).toBeDefined();
    expect(screen.getByRole("cell", { name: "foo" })).toBeDefined();
    expect(screen.getByRole("cell", { name: "1" })).toBeDefined();
  });

  it("renders unordered and ordered lists with items", () => {
    render(
      <Markdown>
        {"- one\n- two\n\n1. first\n2. second"}
      </Markdown>,
    );
    expect(screen.getByText("one")).toBeDefined();
    expect(screen.getByText("two")).toBeDefined();
    expect(screen.getByText("first")).toBeDefined();
    expect(screen.getByText("second")).toBeDefined();

    const lists = document.querySelectorAll("ul, ol");
    expect(lists.length).toBe(2);
  });

  it("renders links with target and rel attributes", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders fenced code blocks distinctly from inline code", () => {
    render(
      <Markdown>
        {"Some `inline code` here.\n\n```js\nconst x = 1;\n```"}
      </Markdown>,
    );
    const inline = screen.getByText("inline code");
    expect(inline.tagName).toBe("CODE");
    expect(inline.className).toContain("px-1");

    const block = screen.getByText("const x = 1;");
    expect(block.tagName).toBe("CODE");
    expect(block.className).toContain("block");
  });

  it("renders bold and italic text", () => {
    render(<Markdown>{"**bold text** and *italic text*"}</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
    const em = screen.getByText("italic text");
    expect(em.tagName).toBe("EM");
  });

  it("renders gracefully with empty string content", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.textContent).toBe("");
  });

  it("applies a custom className to the wrapping element", () => {
    const { container } = render(
      <Markdown className="my-custom-class">{"hello"}</Markdown>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("my-custom-class");
  });
});
