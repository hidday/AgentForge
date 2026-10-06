import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate()", () => {
  it("reads a known prompt template file from the prompts directory", () => {
    const template = loadPromptTemplate("planner.system.md");
    expect(typeof template).toBe("string");
    expect(template.length).toBeGreaterThan(0);
  });

  it("throws when the requested template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate()", () => {
  it("substitutes a simple top-level string variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("substitutes a nested path variable", () => {
    const result = renderTemplate("{{issue.title}}", { issue: { title: "Fix the bug" } });
    expect(result).toBe("Fix the bug");
  });

  it("renders a number variable as its string form", () => {
    const result = renderTemplate("Count: {{count}}", { count: 42 });
    expect(result).toBe("Count: 42");
  });

  it("renders a boolean variable as its string form", () => {
    const result = renderTemplate("Flag: {{flag}}", { flag: true });
    expect(result).toBe("Flag: true");

    const resultFalse = renderTemplate("Flag: {{flag}}", { flag: false });
    expect(resultFalse).toBe("Flag: false");
  });

  it("renders null or undefined variables as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[]");
  });

  it("JSON-stringifies a plain object value that isn't an array", () => {
    const result = renderTemplate("{{config}}", { config: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("renders an array of primitive values as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["first", "second"] });
    expect(result).toBe("1. first\n2. second");
  });

  it("renders an array of objects as bulleted key/value blocks", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "a", title: "A" }],
    });
    expect(result).toBe("  - id: a\n  - title: A");
  });

  it("renders an empty array as an empty string", () => {
    const result = renderTemplate("[{{items}}]", { items: [] });
    expect(result).toBe("[]");
  });

  it("leaves the placeholder untouched when a nested path traverses a non-object intermediate value", () => {
    // "issue" resolves to a string, so "issue.title" cannot descend further.
    const result = renderTemplate("{{issue.title}}", { issue: "not an object" });
    expect(result).toBe("{{issue.title}}");
  });

  it("leaves the placeholder untouched when a nested path traverses an undefined intermediate value", () => {
    const result = renderTemplate("{{a.b.c}}", { a: {} });
    expect(result).toBe("{{a.b.c}}");
  });

  it("replaces multiple distinct placeholders in the same template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "foo", b: "bar" });
    expect(result).toBe("foo and bar");
  });
});
