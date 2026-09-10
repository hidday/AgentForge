import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

const KITCHEN_SINK = `
# Heading 1
## Heading 2
### Heading 3
#### Heading 4

A paragraph with **bold**, *italic*, and \`inline code\`.

- item one
- item two

1. first
2. second

> a quote

---

[a link](https://example.com)

\`\`\`js
const x = 1;
\`\`\`

| A | B |
| --- | --- |
| 1 | 2 |
`;

describe("Markdown", () => {
  it("renders headings at every level", () => {
    render(<Markdown>{KITCHEN_SINK}</Markdown>);
    expect(screen.getByText("Heading 1").tagName).toBe("H1");
    expect(screen.getByText("Heading 2").tagName).toBe("H2");
    expect(screen.getByText("Heading 3").tagName).toBe("H3");
    expect(screen.getByText("Heading 4").tagName).toBe("H4");
  });

  it("renders bold, italic, and inline code", () => {
    render(<Markdown>{KITCHEN_SINK}</Markdown>);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
    expect(screen.getByText("inline code").tagName).toBe("CODE");
  });

  it("renders unordered and ordered lists", () => {
    render(<Markdown>{KITCHEN_SINK}</Markdown>);
    expect(screen.getByText("item one").closest("ul")).not.toBeNull();
    expect(screen.getByText("first").closest("ol")).not.toBeNull();
  });

  it("renders blockquotes and horizontal rules", () => {
    const { container } = render(<Markdown>{KITCHEN_SINK}</Markdown>);
    expect(screen.getByText("a quote").closest("blockquote")).not.toBeNull();
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders links opening in a new tab", () => {
    render(<Markdown>{KITCHEN_SINK}</Markdown>);
    const link = screen.getByText("a link");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders fenced code blocks distinctly from inline code", () => {
    const { container } = render(<Markdown>{KITCHEN_SINK}</Markdown>);
    const block = container.querySelector("pre code")!;
    expect(block.className).toContain("block");
    expect(block.textContent).toContain("const x = 1;");
  });

  it("renders GFM tables with header and data cells", () => {
    render(<Markdown>{KITCHEN_SINK}</Markdown>);
    expect(screen.getByText("A").tagName).toBe("TH");
    expect(screen.getByText("1").tagName).toBe("TD");
  });

  it("applies a custom className to the wrapper", () => {
    const { container } = render(<Markdown className="extra">hello</Markdown>);
    expect(container.firstChild).toHaveProperty("className", expect.stringContaining("extra"));
  });
});
