import { describe, it, expect } from "vitest";
import { renderTemplate, loadPromptTemplate } from "../../src/agents/promptRenderer.js";

describe("renderTemplate", () => {
  it("substitutes simple string values", () => {
    expect(renderTemplate("Hello {{name}}", { name: "World" })).toBe("Hello World");
  });

  it("substitutes nested object paths", () => {
    expect(renderTemplate("{{issue.title}}", { issue: { title: "Fix bug" } })).toBe("Fix bug");
  });

  it("renders numbers and booleans via String()", () => {
    expect(renderTemplate("{{count}}", { count: 5 })).toBe("5");
    expect(renderTemplate("{{flag}}", { flag: true })).toBe("true");
  });

  it("renders null/undefined values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[]");
  });

  it("leaves the placeholder untouched when an intermediate path segment is not an object", () => {
    expect(renderTemplate("{{a.b.c}}", { a: "not an object" })).toBe("{{a.b.c}}");
  });

  it("leaves the placeholder untouched when the root value itself is not an object", () => {
    // vars is always an object, but a nested non-object reached mid-path should
    // short-circuit back to the literal placeholder rather than throwing.
    expect(renderTemplate("{{a.b}}", { a: null })).toBe("{{a.b}}");
  });

  it("renders an array of primitive items as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["one", "two"] });
    expect(result).toBe("1. one\n2. two");
  });

  it("renders an array of objects as bulleted key/value entries", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "a", label: "Alpha" }],
    });
    expect(result).toBe("  - id: a\n  - label: Alpha");
  });

  it("stringifies object values inside an array entry that are not primitives", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ nested: { deep: 1 } }],
    });
    expect(result).toContain('"deep":1');
  });

  it("JSON-stringifies a plain object value used directly (not inside an array)", () => {
    const result = renderTemplate("{{obj}}", { obj: { a: 1 } });
    expect(result).toBe('{"a":1}');
  });

  it("replaces multiple distinct placeholders in the same template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "X", b: "Y" });
    expect(result).toBe("X and Y");
  });
});

describe("loadPromptTemplate", () => {
  it("loads a real prompt template file from the prompts directory", () => {
    const content = loadPromptTemplate("planner.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});
