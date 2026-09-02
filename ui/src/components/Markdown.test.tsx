import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain text inside a paragraph", () => {
    render(<Markdown>Just plain text</Markdown>);
    expect(screen.getByText("Just plain text").tagName).toBe("P");
  });

  it("renders headings at the correct levels", () => {
    render(
      <Markdown>{"# Heading 1\n\n## Heading 2\n\n### Heading 3\n\n#### Heading 4"}</Markdown>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Heading 1");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Heading 2");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Heading 3");
    expect(screen.getByRole("heading", { level: 4 }).textContent).toBe("Heading 4");
  });

  it("renders an unordered list with its items", () => {
    render(<Markdown>{"- first item\n- second item"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("first item");
    expect(items[1].textContent).toBe("second item");
  });

  it("renders an ordered list", () => {
    render(<Markdown>{"1. alpha\n2. beta"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders bold text as <strong> and italic text as <em>", () => {
    render(<Markdown>{"**bold** and *italic*"}</Markdown>);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
  });

  it("renders inline code without block styling", () => {
    const { container } = render(<Markdown>{"Use `inline()` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("inline()");
    expect(code!.className).not.toContain("block");
  });

  it("renders fenced code blocks with block styling", () => {
    const { container } = render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = container.querySelector("code.block");
    expect(code).not.toBeNull();
    expect(code!.textContent).toContain("const x = 1;");
    expect(container.querySelector("pre")).not.toBeNull();
  });

  it("renders links with target=_blank and rel attributes", () => {
    render(<Markdown>{"[Anthropic](https://anthropic.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "Anthropic" });
    expect(link.getAttribute("href")).toBe("https://anthropic.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders blockquotes", () => {
    const { container } = render(<Markdown>{"> A quoted line"}</Markdown>);
    const bq = container.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq!.textContent).toContain("A quoted line");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"Above\n\n---\n\nBelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders GFM tables with th/td cells", () => {
    const { container } = render(
      <Markdown>{"| A | B |\n| --- | --- |\n| 1 | 2 |"}</Markdown>,
    );
    expect(container.querySelector("table")).not.toBeNull();
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["A", "B"]);
    const cells = screen.getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual(["1", "2"]);
  });

  it("renders nothing but does not throw for an empty string", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.querySelector("p")).toBeNull();
  });

  it("applies the passed className to the wrapping div", () => {
    const { container } = render(<Markdown className="my-custom-class">hi</Markdown>);
    expect(container.firstElementChild?.className).toContain("my-custom-class");
  });
});
