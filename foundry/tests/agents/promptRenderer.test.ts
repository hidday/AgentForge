import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads a real template file from the prompts directory", () => {
    const content = loadPromptTemplate("planner.system.md");
    expect(content).toContain("planning agent");
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a top-level string variable", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("substitutes a nested path variable", () => {
    expect(renderTemplate("{{repo.name}}", { repo: { name: "test-repo" } })).toBe("test-repo");
  });

  it("stringifies numbers and booleans", () => {
    expect(renderTemplate("{{count}} {{flag}}", { count: 3, flag: true })).toBe("3 true");
  });

  it("renders null/undefined values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[]");
  });

  it("JSON-stringifies plain object values", () => {
    expect(renderTemplate("{{obj}}", { obj: { a: 1 } })).toBe('{"a":1}');
  });

  it("renders an array of primitives as a numbered list", () => {
    expect(renderTemplate("{{items}}", { items: ["a", "b"] })).toBe("1. a\n2. b");
  });

  it("renders an array of objects as per-item key/value bullet lists", () => {
    const result = renderTemplate("{{items}}", { items: [{ id: "x1", title: "T1" }] });
    expect(result).toBe("  - id: x1\n  - title: T1");
  });

  it("leaves the original placeholder untouched when a path segment is not traversable", () => {
    // `repo` resolves to a string, so `.name` cannot be traversed further.
    expect(renderTemplate("{{repo.name}}", { repo: "not-an-object" })).toBe("{{repo.name}}");
  });

  it("leaves the placeholder untouched when the root path key is entirely missing", () => {
    expect(renderTemplate("{{missing.deeply.nested}}", {})).toBe("{{missing.deeply.nested}}");
  });

  it("replaces multiple distinct placeholders in one template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "first", b: "second" });
    expect(result).toBe("first and second");
  });
});
