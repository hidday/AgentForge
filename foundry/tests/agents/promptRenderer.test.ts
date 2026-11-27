import { describe, it, expect } from "vitest";
import { renderTemplate, loadPromptTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("loads a real prompt template file from the prompts directory as a string", () => {
    const content = loadPromptTemplate("planner.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the requested template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple top-level variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("substitutes a nested dotted-path variable", () => {
    const result = renderTemplate("{{issue.title}}", { issue: { title: "Fix the bug" } });
    expect(result).toBe("Fix the bug");
  });

  it("leaves the placeholder untouched when the path resolves through a non-object value", () => {
    const result = renderTemplate("{{issue.title.nested}}", { issue: { title: "Fix the bug" } });
    expect(result).toBe("{{issue.title.nested}}");
  });

  it("leaves the placeholder untouched when a path segment is missing entirely", () => {
    const result = renderTemplate("{{missing.path}}", {});
    expect(result).toBe("{{missing.path}}");
  });

  it("renders null and undefined values as an empty string", () => {
    expect(renderTemplate("[{{a}}]", { a: null })).toBe("[]");
    expect(renderTemplate("[{{a}}]", { a: undefined })).toBe("[]");
  });

  it("renders numbers and booleans via String()", () => {
    expect(renderTemplate("{{n}}", { n: 42 })).toBe("42");
    expect(renderTemplate("{{b}}", { b: false })).toBe("false");
  });

  it("JSON-stringifies a plain object value that isn't null/string/number/boolean/array", () => {
    const result = renderTemplate("{{obj}}", { obj: { a: 1 } });
    expect(result).toBe(JSON.stringify({ a: 1 }));
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["first", "second"] });
    expect(result).toBe("1. first\n2. second");
  });

  it("renders an array of objects as bulleted key/value lines", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "a", title: "Title A" }],
    });
    expect(result).toBe("  - id: a\n  - title: Title A");
  });

  it("renders an empty array as an empty string", () => {
    const result = renderTemplate("[{{items}}]", { items: [] });
    expect(result).toBe("[]");
  });

  it("replaces multiple distinct placeholders in one template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "foo", b: "bar" });
    expect(result).toBe("foo and bar");
  });
});
