import { describe, it, expect } from "vitest";
import { renderTemplate, loadPromptTemplate } from "../../src/agents/promptRenderer.js";

describe("renderTemplate", () => {
  it("replaces a simple string variable", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("stringifies number and boolean values", () => {
    expect(renderTemplate("count={{count}} active={{active}}", { count: 3, active: true })).toBe(
      "count=3 active=true",
    );
  });

  it("renders null/undefined values as an empty string", () => {
    expect(renderTemplate("value=[{{missing}}]", { missing: null })).toBe("value=[]");
    expect(renderTemplate("value=[{{missing}}]", { missing: undefined })).toBe("value=[]");
  });

  it("JSON-stringifies a plain object value that is not null/string/number/boolean", () => {
    expect(renderTemplate("obj={{obj}}", { obj: { a: 1, b: "two" } })).toBe('obj={"a":1,"b":"two"}');
  });

  it("resolves a nested dotted path", () => {
    expect(renderTemplate("{{repo.name}}", { repo: { name: "test-repo" } })).toBe("test-repo");
  });

  it("leaves the placeholder untouched when an intermediate path segment is not an object", () => {
    expect(renderTemplate("{{repo.name.deep}}", { repo: { name: "test-repo" } })).toBe(
      "{{repo.name.deep}}",
    );
  });

  it("leaves the placeholder untouched when the root value for the path is not an object", () => {
    expect(renderTemplate("{{count.value}}", { count: 5 })).toBe("{{count.value}}");
  });

  it("leaves the placeholder untouched when an intermediate value is null", () => {
    expect(renderTemplate("{{repo.name}}", { repo: null })).toBe("{{repo.name}}");
  });

  it("renders an array of primitive items as a numbered list", () => {
    expect(renderTemplate("{{items}}", { items: ["a", "b"] })).toBe("1. a\n2. b");
  });

  it("renders an array of objects as nested bullet lists of their entries", () => {
    const result = renderTemplate("{{rows}}", {
      rows: [
        { id: "s1", title: "Step 1" },
        { id: "s2", title: "Step 2" },
      ],
    });
    expect(result).toBe("  - id: s1\n  - title: Step 1\n  - id: s2\n  - title: Step 2");
  });

  it("stringifies nested object values within array-of-objects entries", () => {
    const result = renderTemplate("{{rows}}", {
      rows: [{ id: "s1", meta: { nested: true } }],
    });
    expect(result).toBe('  - id: s1\n  - meta: {"nested":true}');
  });

  it("renders an empty array as an empty string", () => {
    expect(renderTemplate("[{{items}}]", { items: [] })).toBe("[]");
  });
});

describe("loadPromptTemplate", () => {
  it("loads an existing prompt template file as a non-empty string", () => {
    const template = loadPromptTemplate("planner.system.md");
    expect(typeof template).toBe("string");
    expect(template.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});
