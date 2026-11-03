import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("renderTemplate", () => {
  it("replaces a simple string variable", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("renders null/undefined values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[]");
  });

  it("stringifies numbers and booleans", () => {
    expect(renderTemplate("{{count}}", { count: 42 })).toBe("42");
    expect(renderTemplate("{{flag}}", { flag: false })).toBe("false");
  });

  it("JSON-stringifies a plain object value (non-array)", () => {
    const result = renderTemplate("{{obj}}", { obj: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("renders a nested path via dot-notation", () => {
    expect(renderTemplate("{{a.b.c}}", { a: { b: { c: "deep" } } })).toBe("deep");
  });

  it("leaves the placeholder untouched when the top-level key is missing", () => {
    expect(renderTemplate("{{a.b}}", {})).toBe("{{a.b}}");
  });

  it("leaves the placeholder untouched when a mid-path value is a non-object primitive", () => {
    // vars.a is a string, so trying to read `.b` off it must bail out
    // and leave the original placeholder text in place rather than throwing.
    expect(renderTemplate("{{a.b}}", { a: "not an object" })).toBe("{{a.b}}");
  });

  it("leaves the placeholder untouched when a mid-path value is null", () => {
    expect(renderTemplate("{{a.b}}", { a: null })).toBe("{{a.b}}");
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["one", "two"] });
    expect(result).toBe("1. one\n2. two");
  });

  it("renders an array of objects as nested bullet lists of their entries", () => {
    const result = renderTemplate("{{steps}}", {
      steps: [{ id: "s1", title: "Step 1" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step 1");
  });

  it("JSON-stringifies non-primitive values inside array-of-object entries", () => {
    const result = renderTemplate("{{steps}}", {
      steps: [{ id: "s1", meta: { nested: true } }],
    });
    expect(result).toContain(`  - meta: ${JSON.stringify({ nested: true })}`);
  });

  it("renders multiple placeholders in the same template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "foo", b: "bar" });
    expect(result).toBe("foo and bar");
  });
});

describe("loadPromptTemplate", () => {
  it("reads an existing prompt template file from disk", () => {
    const content = loadPromptTemplate("executor.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});
