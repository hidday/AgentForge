import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown", () => {
  it("renders headings, emphasis, inline code, and lists", () => {
    const md = [
      "# Heading One",
      "",
      "## Heading Two",
      "",
      "Some **bold** and *italic* text with `inline code`.",
      "",
      "- First item",
      "- Second item",
      "",
      "[Visit site](https://example.com)",
    ].join("\n");

    render(<Markdown>{md}</Markdown>);

    expect(
      screen.getByRole("heading", { level: 1, name: "Heading One" }),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 2, name: "Heading Two" }),
    ).toBeDefined();

    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");

    const inlineCode = screen.getByText("inline code");
    expect(inlineCode.tagName).toBe("CODE");
    // Inline code should not get the block-code styling.
    expect(inlineCode.className).not.toContain("block");

    expect(screen.getByText("First item").closest("ul")).not.toBeNull();
    expect(screen.getByText("Second item")).toBeDefined();

    const link = screen.getByRole("link", { name: "Visit site" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders ordered lists distinctly from unordered lists", () => {
    const md = "1. Step one\n2. Step two";
    render(<Markdown>{md}</Markdown>);

    const ol = screen.getByText("Step one").closest("ol");
    expect(ol).not.toBeNull();
    expect(screen.getByText("Step two")).toBeDefined();
  });

  it("renders fenced code blocks with block styling distinct from inline code", () => {
    const md = "```js\nconst a = 1;\n```";
    const { container } = render(<Markdown>{md}</Markdown>);

    const codeEl = container.querySelector("pre code");
    expect(codeEl).not.toBeNull();
    expect(codeEl!.textContent).toContain("const a = 1;");
    expect(codeEl!.className).toContain("block");
  });

  it("renders an empty wrapper for empty string input without throwing", () => {
    const { container } = render(<Markdown>{""}</Markdown>);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.textContent).toBe("");
  });

  it("applies the provided className to the outer wrapper", () => {
    const { container } = render(
      <Markdown className="custom-class">Hello world</Markdown>,
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("custom-class");
    expect(screen.getByText("Hello world")).toBeDefined();
  });
});
