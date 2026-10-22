import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads a real prompt template file from the prompts directory", () => {
    const content = loadPromptTemplate("planner.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple top-level string variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("substitutes a nested dotted-path variable", () => {
    const result = renderTemplate("Repo: {{repo.name}}", { repo: { name: "acme/app" } });
    expect(result).toBe("Repo: acme/app");
  });

  it("leaves the placeholder untouched when an intermediate path segment is null", () => {
    const result = renderTemplate("{{repo.name}}", { repo: null });
    expect(result).toBe("{{repo.name}}");
  });

  it("leaves the placeholder untouched when an intermediate path segment is a primitive, not an object", () => {
    const result = renderTemplate("{{repo.name.deep}}", { repo: { name: "acme" } });
    expect(result).toBe("{{repo.name.deep}}");
  });

  it("renders null/undefined values as an empty string", () => {
    expect(renderTemplate("[{{a}}]", { a: null })).toBe("[]");
    expect(renderTemplate("[{{a}}]", { a: undefined })).toBe("[]");
  });

  it("renders numbers and booleans via String()", () => {
    expect(renderTemplate("{{n}}", { n: 42 })).toBe("42");
    expect(renderTemplate("{{b}}", { b: false })).toBe("false");
  });

  it("renders a plain object value as JSON", () => {
    const result = renderTemplate("{{meta}}", { meta: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["first", "second"] });
    expect(result).toBe("1. first\n2. second");
  });

  it("renders an array of objects as bulleted key: value blocks", () => {
    const result = renderTemplate("{{rows}}", {
      rows: [{ id: "a", title: "First" }, { id: "b", title: "Second" }],
    });
    expect(result).toBe("  - id: a\n  - title: First\n  - id: b\n  - title: Second");
  });

  it("renders an empty array as an empty string", () => {
    const result = renderTemplate("[{{items}}]", { items: [] });
    expect(result).toBe("[]");
  });

  it("substitutes multiple distinct placeholders in one template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "x", b: "y" });
    expect(result).toBe("x and y");
  });
});
