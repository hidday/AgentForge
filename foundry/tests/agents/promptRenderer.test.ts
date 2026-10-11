import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("loads an existing template file's contents", () => {
    const content = loadPromptTemplate("executor.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple top-level string value", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("substitutes a nested path value", () => {
    const result = renderTemplate("{{a.b.c}}", { a: { b: { c: "deep" } } });
    expect(result).toBe("deep");
  });

  it("renders null and undefined values as an empty string", () => {
    expect(renderTemplate("[{{x}}]", { x: null })).toBe("[]");
    expect(renderTemplate("[{{x}}]", { x: undefined })).toBe("[]");
  });

  it("renders numbers and booleans via String()", () => {
    expect(renderTemplate("{{n}}", { n: 42 })).toBe("42");
    expect(renderTemplate("{{b}}", { b: false })).toBe("false");
  });

  it("renders a plain (non-array) object value as JSON", () => {
    const result = renderTemplate("{{obj}}", { obj: { foo: "bar" } });
    expect(result).toBe(JSON.stringify({ foo: "bar" }));
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["a", "b"] });
    expect(result).toBe("1. a\n2. b");
  });

  it("renders an array of objects as bullet-point key/value blocks", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "x1", title: "T1" }],
    });
    expect(result).toBe("  - id: x1\n  - title: T1");
  });

  it("renders an empty array as an empty string", () => {
    const result = renderTemplate("[{{items}}]", { items: [] });
    expect(result).toBe("[]");
  });

  it("leaves the placeholder unresolved when an intermediate path segment is not an object", () => {
    const result = renderTemplate("{{a.b}}", { a: "not-an-object" });
    expect(result).toBe("{{a.b}}");
  });

  it("leaves the placeholder unresolved when the root vars value for the path is primitive and path has multiple segments", () => {
    const result = renderTemplate("prefix {{missing.deep.path}} suffix", {});
    expect(result).toBe("prefix {{missing.deep.path}} suffix");
  });

  it("trims whitespace inside the placeholder braces", () => {
    const result = renderTemplate("{{ name }}", { name: "Trimmed" });
    expect(result).toBe("Trimmed");
  });

  it("replaces multiple distinct placeholders in one template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "1", b: "2" });
    expect(result).toBe("1 and 2");
  });
});
