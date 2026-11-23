import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders bold text using the strong component with the expected styling", () => {
    render(<Markdown>{"**bold text**"}</Markdown>);
    const strong = screen.getByText("bold text");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("font-semibold");
  });

  it("renders italic text using the em component", () => {
    render(<Markdown>{"_italic text_"}</Markdown>);
    const em = screen.getByText("italic text");
    expect(em.tagName).toBe("EM");
    expect(em.className).toContain("italic");
  });

  it("renders a link with target=_blank and rel=noreferrer noopener", () => {
    render(<Markdown>{"[click here](https://example.com)"}</Markdown>);
    const link = screen.getByRole("link", { name: "click here" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders inline code without the block code styling", () => {
    render(<Markdown>{"use `inline()` here"}</Markdown>);
    const code = screen.getByText("inline()");
    expect(code.tagName).toBe("CODE");
    expect(code.className).not.toContain("whitespace-pre");
  });

  it("renders fenced code blocks with block code styling", () => {
    render(<Markdown>{"```js\nconst x = 1;\n```"}</Markdown>);
    const code = screen.getByText("const x = 1;");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("whitespace-pre");
  });

  it("renders an unordered list with list items", () => {
    render(<Markdown>{"- one\n- two"}</Markdown>);
    expect(screen.getByText("one").closest("ul")).not.toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders a GFM table (via remark-gfm) with headers and cells", () => {
    render(
      <Markdown>
        {"| A | B |\n| --- | --- |\n| 1 | 2 |"}
      </Markdown>,
    );
    expect(screen.getByRole("columnheader", { name: "A" })).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
  });

  it("merges a custom className onto the wrapper div", () => {
    const { container } = render(
      <Markdown className="extra-class">{"plain text"}</Markdown>,
    );
    expect(container.firstChild).not.toBeNull();
    expect((container.firstChild as HTMLElement).className).toContain("extra-class");
  });
});
