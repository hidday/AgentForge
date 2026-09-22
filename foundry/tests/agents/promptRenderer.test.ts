import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads an existing prompt template file from the prompts directory", () => {
    const content = loadPromptTemplate("reviewer.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple string variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("substitutes a nested path variable", () => {
    const result = renderTemplate("Repo: {{repo.name}}", { repo: { name: "foundry" } });
    expect(result).toBe("Repo: foundry");
  });

  it("renders a number value via String()", () => {
    const result = renderTemplate("Count: {{count}}", { count: 42 });
    expect(result).toBe("Count: 42");
  });

  it("renders a boolean value via String()", () => {
    const result = renderTemplate("Enabled: {{flag}}", { flag: true });
    expect(result).toBe("Enabled: true");
    expect(renderTemplate("Enabled: {{flag}}", { flag: false })).toBe("Enabled: false");
  });

  it("renders null and undefined as empty strings", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[]");
  });

  it("renders a plain object value as JSON", () => {
    const result = renderTemplate("Obj: {{obj}}", { obj: { a: 1 } });
    expect(result).toBe('Obj: {"a":1}');
  });

  it("renders an empty string when the top-level key is missing (resolves to undefined)", () => {
    const result = renderTemplate("Value: [{{missingKey}}]", {});
    expect(result).toBe("Value: []");
  });

  it("leaves the placeholder unchanged when a nested path segment does not exist", () => {
    // repo.nonexistent resolves to undefined; traversing `.deep` off undefined
    // hits the null/non-object guard, so the original placeholder is kept.
    const result = renderTemplate("Value: {{repo.nonexistent.deep}}", { repo: { name: "x" } });
    expect(result).toBe("Value: {{repo.nonexistent.deep}}");
  });

  it("leaves the placeholder unchanged when traversing into a primitive mid-path", () => {
    // repo.name is a string; repo.name.nested cannot be traversed further.
    const result = renderTemplate("Value: {{repo.name.nested}}", { repo: { name: "x" } });
    expect(result).toBe("Value: {{repo.name.nested}}");
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["a", "b", "c"] });
    expect(result).toBe("1. a\n2. b\n3. c");
  });

  it("renders an array of objects as bullet lists of key/value pairs", () => {
    const result = renderTemplate("{{steps}}", {
      steps: [{ id: "s1", title: "First" }],
    });
    expect(result).toBe("  - id: s1\n  - title: First");
  });

  it("renders an empty array as an empty string", () => {
    const result = renderTemplate("[{{items}}]", { items: [] });
    expect(result).toBe("[]");
  });

  it("trims whitespace inside the placeholder path", () => {
    const result = renderTemplate("Hello {{ name }}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("replaces multiple distinct placeholders in one template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "1", b: "2" });
    expect(result).toBe("1 and 2");
  });
});
