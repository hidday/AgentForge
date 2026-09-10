import { describe, it, expect } from "vitest";
import { renderTemplate, loadPromptTemplate } from "../../src/agents/promptRenderer.js";

describe("renderTemplate", () => {
  it("substitutes a simple top-level string variable", () => {
    expect(renderTemplate("Hello {{name}}", { name: "World" })).toBe("Hello World");
  });

  it("substitutes a nested dotted-path variable", () => {
    expect(renderTemplate("{{repo.name}}", { repo: { name: "acme" } })).toBe("acme");
  });

  it("renders numbers and booleans via String()", () => {
    expect(renderTemplate("{{count}}", { count: 5 })).toBe("5");
    expect(renderTemplate("{{active}}", { active: false })).toBe("false");
  });

  it("renders null/undefined values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", {})).toBe("[]");
  });

  it("JSON-stringifies an object value that isn't an array", () => {
    expect(renderTemplate("{{meta}}", { meta: { a: 1, b: "x" } })).toBe(
      JSON.stringify({ a: 1, b: "x" }),
    );
  });

  it("renders an array of primitives as a numbered list", () => {
    expect(renderTemplate("{{items}}", { items: ["a", "b"] })).toBe("1. a\n2. b");
  });

  it("renders an array of objects as bulleted key/value blocks", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "s1", title: "Step 1" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step 1");
  });

  it("leaves the placeholder literal when a path segment is missing mid-traversal", () => {
    expect(renderTemplate("{{repo.name}}", { repo: null })).toBe("{{repo.name}}");
    expect(renderTemplate("{{repo.name}}", { repo: "not-an-object" })).toBe("{{repo.name}}");
  });

  it("leaves the placeholder literal when the top-level key is entirely missing", () => {
    expect(renderTemplate("{{repo.deeply.nested}}", {})).toBe("{{repo.deeply.nested}}");
  });

  it("replaces multiple placeholders in one template", () => {
    expect(renderTemplate("{{a}} and {{b}}", { a: "x", b: "y" })).toBe("x and y");
  });
});

describe("loadPromptTemplate", () => {
  it("reads a real prompt template file from disk", () => {
    const content = loadPromptTemplate("reviewer.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });
});
