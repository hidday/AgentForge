import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders paragraphs, bold, and italic text", () => {
    render(<Markdown>{"A paragraph with **bold** and *italic* text."}</Markdown>);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
  });

  it("renders unordered and ordered lists", () => {
    const { container } = render(<Markdown>{"- one\n- two\n\n1. first\n2. second"}</Markdown>);
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelector("ol")).not.toBeNull();
    expect(screen.getByText("one").tagName).toBe("LI");
  });

  it("renders inline code and a fenced code block differently", () => {
    const { container } = render(
      <Markdown>{"Use `inline()` here.\n\n```ts\nconst x = 1;\n```"}</Markdown>,
    );
    const codes = container.querySelectorAll("code");
    expect(codes.length).toBeGreaterThanOrEqual(2);
    const blockCode = Array.from(codes).find((c) => c.className.includes("block"));
    expect(blockCode).toBeDefined();
  });

  it("renders a link opening in a new tab", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("renders headings h1 through h4", () => {
    const { container } = render(
      <Markdown>{"# H1\n## H2\n### H3\n#### H4"}</Markdown>,
    );
    expect(container.querySelector("h1")).not.toBeNull();
    expect(container.querySelector("h2")).not.toBeNull();
    expect(container.querySelector("h3")).not.toBeNull();
    expect(container.querySelector("h4")).not.toBeNull();
  });

  it("renders a blockquote and a horizontal rule", () => {
    const { container } = render(<Markdown>{"> a quote\n\n---"}</Markdown>);
    expect(container.querySelector("blockquote")).not.toBeNull();
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a GFM table with header and data cells", () => {
    const { container } = render(
      <Markdown>{"| A | B |\n| --- | --- |\n| 1 | 2 |"}</Markdown>,
    );
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("th")).not.toBeNull();
    expect(container.querySelector("td")).not.toBeNull();
  });

  it("applies the extra className to the wrapper", () => {
    const { container } = render(<Markdown className="extra">text</Markdown>);
    expect(container.firstChild).toHaveProperty("className", expect.stringContaining("extra"));
  });
});
