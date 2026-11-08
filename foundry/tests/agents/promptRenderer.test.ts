import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("loads a real prompt template file's contents", () => {
    const content = loadPromptTemplate("_execution-score-rubric.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple top-level string value", () => {
    expect(renderTemplate("Hello {{name}}", { name: "World" })).toBe("Hello World");
  });

  it("stringifies number values", () => {
    expect(renderTemplate("Count: {{count}}", { count: 42 })).toBe("Count: 42");
  });

  it("stringifies boolean values", () => {
    expect(renderTemplate("Done: {{done}}", { done: true })).toBe("Done: true");
    expect(renderTemplate("Done: {{done}}", { done: false })).toBe("Done: false");
  });

  it("renders null and undefined values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", {})).toBe("[]");
  });

  it("JSON-stringifies a plain object value that is not an array", () => {
    const result = renderTemplate("{{obj}}", { obj: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("renders an array of primitive values as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["first", "second"] });
    expect(result).toBe("1. first\n2. second");
  });

  it("renders an array of objects as dash-separated key/value lines", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "a1", title: "Step one" }],
    });
    expect(result).toBe("  - id: a1\n  - title: Step one");
  });

  it("renders nested object field values inside array items using toDisplayString", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "a1", count: 3, active: true, meta: null }],
    });
    expect(result).toBe("  - id: a1\n  - count: 3\n  - active: true\n  - meta: ");
  });

  it("resolves a nested dotted path", () => {
    expect(renderTemplate("{{repo.name}}", { repo: { name: "test-repo" } })).toBe("test-repo");
  });

  it("leaves the placeholder unchanged when an intermediate path segment is not an object", () => {
    const result = renderTemplate("{{a.b}}", { a: "just-a-string" });
    expect(result).toBe("{{a.b}}");
  });

  it("leaves the placeholder unchanged when an intermediate path segment is missing", () => {
    const result = renderTemplate("{{a.b.c}}", { a: {} });
    expect(result).toBe("{{a.b.c}}");
  });

  it("supports multiple placeholders in the same template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "x", b: "y" });
    expect(result).toBe("x and y");
  });
});
