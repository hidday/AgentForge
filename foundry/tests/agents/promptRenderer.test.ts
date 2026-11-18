import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("loads a real prompt template file from the prompts directory", () => {
    const template = loadPromptTemplate("planner.system.md");
    expect(typeof template).toBe("string");
    expect(template.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes simple string, number and boolean values", () => {
    const result = renderTemplate("{{name}} is {{age}} and active: {{active}}", {
      name: "Alice",
      age: 30,
      active: true,
    });
    expect(result).toBe("Alice is 30 and active: true");
  });

  it("resolves nested dotted paths", () => {
    const result = renderTemplate("{{repo.name}}", { repo: { name: "acme" } });
    expect(result).toBe("acme");
  });

  it("renders null/undefined values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[]");
  });

  it("JSON-stringifies plain object values that are not arrays", () => {
    const result = renderTemplate("{{meta}}", { meta: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("leaves the placeholder untouched when the path resolves through a non-object mid-path", () => {
    // `name` is a string, so `name.nested` cannot be traversed further.
    const result = renderTemplate("{{name.nested}}", { name: "Alice" });
    expect(result).toBe("{{name.nested}}");
  });

  it("leaves the placeholder untouched when an intermediate key is null", () => {
    const result = renderTemplate("{{repo.name}}", { repo: null });
    expect(result).toBe("{{repo.name}}");
  });

  it("renders a list of primitive values as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["a", "b"] });
    expect(result).toBe("1. a\n2. b");
  });

  it("renders a list of objects as bullet key/value blocks", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "x1", label: "First" }],
    });
    expect(result).toBe("  - id: x1\n  - label: First");
  });

  it("trims whitespace around the path expression", () => {
    const result = renderTemplate("{{ name }}", { name: "Alice" });
    expect(result).toBe("Alice");
  });
});
