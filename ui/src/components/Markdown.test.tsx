import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders a level-1 heading as an h1 element", () => {
    render(<Markdown># Hello</Markdown>);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Hello");
  });

  it("renders a level-3 heading as an h3 element", () => {
    render(<Markdown>### Sub heading</Markdown>);
    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading.textContent).toBe("Sub heading");
  });

  it("renders a level-4 heading as an h4 element", () => {
    render(<Markdown>#### Smallest heading</Markdown>);
    const heading = screen.getByRole("heading", { level: 4 });
    expect(heading.textContent).toBe("Smallest heading");
  });

  it("renders a fenced code block with the block styling (whitespace-pre)", () => {
    const { container } = render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.className).toContain("whitespace-pre");
    expect(code?.textContent).toContain("const x = 1;");
  });

  it("renders inline code without the block styling", () => {
    const { container } = render(<Markdown>Use `foo()` here</Markdown>);
    const code = container.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.className).not.toContain("whitespace-pre");
    expect(code?.textContent).toBe("foo()");
  });

  it("renders a link with target=_blank and rel attributes", () => {
    render(<Markdown>[click here](https://example.com)</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("one");
    expect(items[1].textContent).toBe("two");
  });

  it("renders an ordered list as an ol element", () => {
    render(<Markdown>{"1. first\n2. second"}</Markdown>);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
  });

  it("renders bold and italic text with the expected elements", () => {
    const { container } = render(<Markdown>**bold** and *italic*</Markdown>);
    const strong = container.querySelector("strong");
    const em = container.querySelector("em");
    expect(strong?.textContent).toBe("bold");
    expect(em?.textContent).toBe("italic");
  });

  it("renders a blockquote", () => {
    const { container } = render(<Markdown>{"> quoted text"}</Markdown>);
    const blockquote = container.querySelector("blockquote");
    expect(blockquote?.textContent?.trim()).toBe("quoted text");
  });

  it("renders a horizontal rule", () => {
    const { container } = render(<Markdown>{"---"}</Markdown>);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with headers and cells", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{md}</Markdown>);
    expect(container.querySelector("table")).not.toBeNull();
    const headers = container.querySelectorAll("th");
    expect(headers).toHaveLength(2);
    expect(headers[0].textContent).toBe("A");
    const cells = container.querySelectorAll("td");
    expect(cells).toHaveLength(2);
    expect(cells[0].textContent).toBe("1");
  });

  it("renders plain paragraph text and applies an additional className to the wrapper", () => {
    const { container } = render(
      <Markdown className="extra-class">Plain paragraph</Markdown>,
    );
    expect(screen.getByText("Plain paragraph").tagName).toBe("P");
    expect(container.firstElementChild?.className).toContain("extra-class");
    expect(container.firstElementChild?.className).toContain("text-text-secondary");
  });

  it("renders an empty string without throwing", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.firstElementChild).not.toBeNull();
  });
});
