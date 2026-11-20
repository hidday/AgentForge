import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads a real prompt template file from src/prompts", () => {
    const template = loadPromptTemplate("planner.system.md");
    expect(typeof template).toBe("string");
    expect(template.length).toBeGreaterThan(0);
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
    const result = renderTemplate("Repo: {{repo.name}}", { repo: { name: "acme/backend" } });
    expect(result).toBe("Repo: acme/backend");
  });

  it("renders null and undefined values as an empty string", () => {
    expect(renderTemplate("[{{a}}]", { a: null })).toBe("[]");
    expect(renderTemplate("[{{a}}]", { a: undefined })).toBe("[]");
  });

  it("renders numbers and booleans via String()", () => {
    expect(renderTemplate("{{count}}", { count: 3 })).toBe("3");
    expect(renderTemplate("{{flag}}", { flag: true })).toBe("true");
    expect(renderTemplate("{{flag}}", { flag: false })).toBe("false");
  });

  it("JSON-stringifies a plain object value", () => {
    const result = renderTemplate("{{obj}}", { obj: { a: 1 } });
    expect(result).toBe(JSON.stringify({ a: 1 }));
  });

  it("leaves the placeholder untouched when an intermediate path segment is not an object", () => {
    const result = renderTemplate("{{a.b.c}}", { a: "not an object" });
    expect(result).toBe("{{a.b.c}}");
  });

  it("leaves the placeholder untouched when an intermediate path segment is null", () => {
    const result = renderTemplate("{{a.b}}", { a: null });
    expect(result).toBe("{{a.b}}");
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["first", "second"] });
    expect(result).toBe("1. first\n2. second");
  });

  it("renders an array of objects as bulleted key/value lines", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "s1", title: "Step One" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step One");
  });

  it("renders an empty array as an empty string", () => {
    const result = renderTemplate("[{{items}}]", { items: [] });
    expect(result).toBe("[]");
  });

  it("leaves unmatched top-level placeholders untouched", () => {
    const result = renderTemplate("{{missing}}", {});
    expect(result).toBe("");
  });
});
