import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("loads a real prompt template file from src/prompts", () => {
    const content = loadPromptTemplate("reviewer.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws for a template file that does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple top-level variable", () => {
    expect(renderTemplate("Hello {{name}}", { name: "World" })).toBe("Hello World");
  });

  it("substitutes a nested dotted-path variable", () => {
    expect(renderTemplate("{{repo.name}}", { repo: { name: "acme" } })).toBe("acme");
  });

  it("renders numbers and booleans via String()", () => {
    expect(renderTemplate("{{count}} {{ok}}", { count: 3, ok: true })).toBe("3 true");
  });

  it("renders null/undefined as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[]");
  });

  it("JSON-stringifies a plain object value that isn't an array", () => {
    expect(renderTemplate("{{meta}}", { meta: { a: 1, b: "x" } })).toBe('{"a":1,"b":"x"}');
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["one", "two"] });
    expect(result).toBe("1. one\n2. two");
  });

  it("renders an array of objects as bullet lists of key: value", () => {
    const result = renderTemplate("{{steps}}", {
      steps: [{ id: "s1", title: "Step 1" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step 1");
  });

  it("leaves the placeholder literal when an intermediate path segment is null", () => {
    const result = renderTemplate("{{a.b.c}}", { a: { b: null } });
    expect(result).toBe("{{a.b.c}}");
  });

  it("leaves the placeholder literal when an intermediate path segment is a primitive", () => {
    const result = renderTemplate("{{a.b.c}}", { a: { b: "not an object" } });
    expect(result).toBe("{{a.b.c}}");
  });

  it("leaves the placeholder literal when the top-level var is entirely missing", () => {
    const result = renderTemplate("{{nope.deep}}", {});
    expect(result).toBe("{{nope.deep}}");
  });

  it("handles multiple placeholders in one template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "x", b: "y" });
    expect(result).toBe("x and y");
  });

  it("trims whitespace inside the placeholder braces", () => {
    expect(renderTemplate("{{ name }}", { name: "Ada" })).toBe("Ada");
  });
});
