import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("loads a real prompt template file's contents from the prompts directory", () => {
    const content = loadPromptTemplate("_execution-score-rubric.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple top-level string variable", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("substitutes nested dotted-path variables", () => {
    expect(renderTemplate("{{issue.title}}", { issue: { title: "Fix bug" } })).toBe("Fix bug");
  });

  it("renders numbers and booleans via String()", () => {
    expect(renderTemplate("{{count}} {{flag}}", { count: 3, flag: true })).toBe("3 true");
  });

  it("renders null/undefined as an empty string", () => {
    expect(renderTemplate("[{{missingVal}}]", { missingVal: null })).toBe("[]");
    expect(renderTemplate("[{{missingVal}}]", { missingVal: undefined })).toBe("[]");
  });

  it("renders a plain (non-array) object value via JSON.stringify", () => {
    const result = renderTemplate("{{meta}}", { meta: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["first", "second"] });
    expect(result).toBe("1. first\n2. second");
  });

  it("renders an array of objects as bulleted key/value lines", () => {
    const result = renderTemplate("{{items}}", { items: [{ id: "s1", title: "Step" }] });
    expect(result).toBe("  - id: s1\n  - title: Step");
  });

  it("leaves the placeholder untouched when the top-level key is missing", () => {
    expect(renderTemplate("{{missing.key}}", {})).toBe("{{missing.key}}");
  });

  it("leaves the placeholder untouched when an intermediate path segment resolves to a non-object", () => {
    // "issue" resolves to a plain string, so ".title" cannot be traversed further.
    expect(renderTemplate("{{issue.title}}", { issue: "not an object" })).toBe(
      "{{issue.title}}",
    );
  });

  it("handles multiple placeholders in the same template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "one", b: "two" });
    expect(result).toBe("one and two");
  });
});
