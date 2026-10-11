import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown.tsx";

describe("Markdown additional renderer branches", () => {
  it("renders an h1 heading with the custom styling", () => {
    render(<Markdown>{"# Top Title"}</Markdown>);
    const heading = screen.getByText("Top Title");
    expect(heading.tagName).toBe("H1");
    expect(heading.className).toContain("font-semibold");
    expect(heading.className).toContain("text-sm");
  });

  it("renders an h3 heading with the custom styling", () => {
    render(<Markdown>{"### Sub Title"}</Markdown>);
    const heading = screen.getByText("Sub Title");
    expect(heading.tagName).toBe("H3");
    expect(heading.className).toContain("text-xs");
  });

  it("renders an h4 heading with the custom styling", () => {
    render(<Markdown>{"#### Minor Title"}</Markdown>);
    const heading = screen.getByText("Minor Title");
    expect(heading.tagName).toBe("H4");
    expect(heading.className).toContain("text-xs");
  });

  it("renders a blockquote with the custom border styling", () => {
    const { container } = render(<Markdown>{"> quoted text"}</Markdown>);
    const blockquote = container.querySelector("blockquote");
    expect(blockquote).not.toBeNull();
    expect(blockquote!.textContent).toContain("quoted text");
    expect(blockquote!.className).toContain("border-l-2");
    expect(blockquote!.className).toContain("text-text-muted");
  });

  it("renders a horizontal rule with the custom styling", () => {
    const { container } = render(<Markdown>{"above\n\n---\n\nbelow"}</Markdown>);
    const hr = container.querySelector("hr");
    expect(hr).not.toBeNull();
    expect(hr!.className).toContain("border-border-subtle");
    expect(hr!.className).toContain("my-2");
  });

  it("renders a GFM table with styled wrapper, header cells and data cells", () => {
    const markdown = ["| Name | Age |", "| --- | --- |", "| Alice | 30 |"].join(
      "\n",
    );
    const { container } = render(<Markdown>{markdown}</Markdown>);

    const wrapper = container.querySelector("div.overflow-x-auto");
    expect(wrapper).not.toBeNull();

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.className).toContain("border-collapse");

    const th = screen.getByText("Name");
    expect(th.tagName).toBe("TH");
    expect(th.className).toContain("font-semibold");

    const ageHeader = screen.getByText("Age");
    expect(ageHeader.tagName).toBe("TH");

    const td = screen.getByText("Alice");
    expect(td.tagName).toBe("TD");
    expect(td.className).toContain("align-top");

    const ageCell = screen.getByText("30");
    expect(ageCell.tagName).toBe("TD");
  });
});
