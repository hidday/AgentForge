import { describe, it, expect } from "vitest";
import { renderTemplate, loadPromptTemplate } from "../../src/agents/promptRenderer.js";

describe("renderTemplate()", () => {
  it("substitutes a simple string variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("substitutes nested object paths", () => {
    const result = renderTemplate("{{issue.title}}", { issue: { title: "Fix bug" } });
    expect(result).toBe("Fix bug");
  });

  it("renders numbers and booleans via String() coercion", () => {
    const result = renderTemplate("{{count}} {{done}}", { count: 3, done: true });
    expect(result).toBe("3 true");
  });

  it("renders a plain object value as JSON via toDisplayString's fallback branch", () => {
    const result = renderTemplate("{{meta}}", { meta: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("renders null/undefined leaf values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[]");
  });

  it("leaves the placeholder untouched when a path segment resolves through a non-object value", () => {
    const result = renderTemplate("{{issue.title}}", { issue: "not-an-object" });
    expect(result).toBe("{{issue.title}}");
  });

  it("leaves the placeholder untouched when an intermediate path segment is null", () => {
    const result = renderTemplate("{{a.b.c}}", { a: { b: null } });
    expect(result).toBe("{{a.b.c}}");
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["first", "second"] });
    expect(result).toBe("1. first\n2. second");
  });

  it("renders an array of objects as bullet lists of their entries", () => {
    const result = renderTemplate("{{items}}", { items: [{ id: "a", score: 1 }] });
    expect(result).toBe("  - id: a\n  - score: 1");
  });

  it("renders an empty array as an empty string", () => {
    const result = renderTemplate("[{{items}}]", { items: [] });
    expect(result).toBe("[]");
  });
});

describe("loadPromptTemplate()", () => {
  it("reads a known prompt template file from the prompts directory", () => {
    const content = loadPromptTemplate("executor.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});
