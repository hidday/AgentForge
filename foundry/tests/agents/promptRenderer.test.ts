import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads an existing prompt template file from the prompts directory", () => {
    const content = loadPromptTemplate("distillation.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the requested template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple top-level string variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("substitutes a nested path variable", () => {
    const result = renderTemplate("Repo: {{repo.name}}", { repo: { name: "foundry" } });
    expect(result).toBe("Repo: foundry");
  });

  it("stringifies numbers and booleans", () => {
    const result = renderTemplate("{{count}} / {{active}}", { count: 3, active: true });
    expect(result).toBe("3 / true");
  });

  it("renders null and undefined as empty string", () => {
    const result = renderTemplate("[{{missingNull}}][{{missingUndef}}]", {
      missingNull: null,
      missingUndef: undefined,
    });
    expect(result).toBe("[][]");
  });

  it("JSON-stringifies a plain object value (non-array)", () => {
    const result = renderTemplate("{{obj}}", { obj: { a: 1, b: "x" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "x" }));
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["first", "second"] });
    expect(result).toBe("1. first\n2. second");
  });

  it("renders an array of objects as bullet lists of key: value pairs", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "a", title: "Title A" }],
    });
    expect(result).toBe("  - id: a\n  - title: Title A");
  });

  it("leaves the placeholder untouched when the top-level key is missing", () => {
    const result = renderTemplate("Value: {{missing.key}}", {});
    expect(result).toBe("Value: {{missing.key}}");
  });

  it("leaves the placeholder untouched when traversal hits a primitive mid-path", () => {
    // `name` is a string, so `name.first` cannot be traversed further.
    const result = renderTemplate("{{name.first}}", { name: "Ada" });
    expect(result).toBe("{{name.first}}");
  });

  it("leaves the placeholder untouched when traversal hits null mid-path", () => {
    const result = renderTemplate("{{a.b.c}}", { a: { b: null } });
    expect(result).toBe("{{a.b.c}}");
  });

  it("trims whitespace inside the mustache delimiters", () => {
    const result = renderTemplate("{{ name }}", { name: "Ada" });
    expect(result).toBe("Ada");
  });

  it("replaces multiple occurrences across the template", () => {
    const result = renderTemplate("{{x}}-{{x}}-{{y}}", { x: "1", y: "2" });
    expect(result).toBe("1-1-2");
  });
});
