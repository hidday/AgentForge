import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders plain text as a paragraph", () => {
    render(<Markdown>Hello world</Markdown>);
    expect(screen.getByText("Hello world")).toBeDefined();
  });

  it("renders an empty string without throwing and produces no visible text", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.textContent).toBe("");
  });

  it("renders a heading with the heading role", () => {
    render(<Markdown># Title Heading</Markdown>);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Title Heading");
  });

  it("renders bold and italic text", () => {
    render(<Markdown>**bold text** and *italic text*</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
    const em = screen.getByText("italic text");
    expect(em.tagName).toBe("EM");
  });

  it("renders a fenced code block with language class as a block-level code element", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText((content) => content.includes("const x = 1;"));
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("block");
  });

  it("renders inline code without the block class", () => {
    render(<Markdown>{"Use `npm install` to set up."}</Markdown>);
    const code = screen.getByText("npm install");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("block");
  });

  it("renders a link with target=_blank and rel attributes", () => {
    render(<Markdown>{"[Anthropic](https://anthropic.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "Anthropic" });
    expect(link.getAttribute("href")).toBe("https://anthropic.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- item one\n- item two"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("item one");
    expect(items[1].textContent).toBe("item two");
  });

  it("renders an ordered list as OL", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
  });

  it("applies a custom className to the wrapping container", () => {
    const { container } = render(
      <Markdown className="custom-markdown-class">hi</Markdown>,
    );
    expect((container.firstChild as HTMLElement).className).toContain(
      "custom-markdown-class",
    );
  });

  it("renders h2, h3, and h4 headings", () => {
    render(
      <Markdown>
        {"## Section Heading\n\n### Sub Heading\n\n#### Minor Heading"}
      </Markdown>,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Section Heading",
    );
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(
      "Sub Heading",
    );
    expect(screen.getByRole("heading", { level: 4 }).textContent).toBe(
      "Minor Heading",
    );
  });

  it("renders a blockquote", () => {
    render(<Markdown>{"> A quoted insight"}</Markdown>);
    const quote = screen.getByText("A quoted insight");
    expect(quote.closest("blockquote")).not.toBeNull();
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders GFM table syntax as a table with th/td cells", () => {
    render(
      <Markdown>
        {"| A | B |\n| --- | --- |\n| 1 | 2 |"}
      </Markdown>,
    );
    const table = screen.getByRole("table");
    expect(table).toBeDefined();
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });
});
