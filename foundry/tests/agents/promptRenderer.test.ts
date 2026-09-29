import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads an existing prompt template file from src/prompts", () => {
    const content = loadPromptTemplate("planner.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("replaces a simple flat variable", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("resolves a nested dotted path", () => {
    expect(renderTemplate("{{a.b.c}}", { a: { b: { c: "deep value" } } })).toBe("deep value");
  });

  it("renders null and undefined values as an empty string", () => {
    expect(renderTemplate("[{{x}}]", { x: null })).toBe("[]");
    expect(renderTemplate("[{{x}}]", { x: undefined })).toBe("[]");
  });

  it("renders a missing top-level key as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", {})).toBe("[]");
  });

  it("passes a string value through unchanged", () => {
    expect(renderTemplate("{{s}}", { s: "already a string" })).toBe("already a string");
  });

  it("stringifies a number value", () => {
    expect(renderTemplate("{{n}}", { n: 42 })).toBe("42");
  });

  it("stringifies boolean values (both true and false)", () => {
    expect(renderTemplate("{{t}}", { t: true })).toBe("true");
    expect(renderTemplate("{{f}}", { f: false })).toBe("false");
  });

  it("JSON-stringifies a plain object value", () => {
    const result = renderTemplate("{{obj}}", { obj: { foo: "bar", n: 1 } });
    expect(result).toBe(JSON.stringify({ foo: "bar", n: 1 }));
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["a", "b", "c"] });
    expect(result).toBe("1. a\n2. b\n3. c");
  });

  it("renders an array of numbers/booleans as a numbered list with stringified values", () => {
    const result = renderTemplate("{{items}}", { items: [1, false, 2] });
    expect(result).toBe("1. 1\n2. false\n3. 2");
  });

  it("renders an array of plain objects as key/value bullet blocks", () => {
    const result = renderTemplate("{{items}}", {
      items: [
        { id: "s1", title: "Step 1" },
        { id: "s2", title: "Step 2" },
      ],
    });
    expect(result).toBe("  - id: s1\n  - title: Step 1\n  - id: s2\n  - title: Step 2");
  });

  it("uses toDisplayString for nested values inside array-of-object items, including nested objects and nulls", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "s1", meta: { nested: true }, note: null, count: 3 }],
    });
    expect(result).toBe(
      `  - id: s1\n  - meta: ${JSON.stringify({ nested: true })}\n  - note: \n  - count: 3`,
    );
  });

  it("renders an empty array as an empty string", () => {
    expect(renderTemplate("[{{items}}]", { items: [] })).toBe("[]");
  });

  it("leaves the placeholder untouched when the path breaks on a non-object intermediate value", () => {
    const result = renderTemplate("{{a.b.c}}", { a: { b: "not an object" } });
    expect(result).toBe("{{a.b.c}}");
  });

  it("leaves the placeholder untouched when the first path segment resolves to a non-object", () => {
    const result = renderTemplate("{{a.b}}", { a: "just a string" });
    expect(result).toBe("{{a.b}}");
  });

  it("renders multiple distinct placeholders in a single template", () => {
    const result = renderTemplate("{{a}} and {{b}} and {{a}}", { a: "X", b: "Y" });
    expect(result).toBe("X and Y and X");
  });

  it("leaves non-placeholder text untouched", () => {
    expect(renderTemplate("no placeholders here", {})).toBe("no placeholders here");
  });
});
