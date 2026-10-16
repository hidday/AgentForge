import { describe, it, expect } from "vitest";
import { renderTemplate, loadPromptTemplate } from "../../src/agents/promptRenderer.js";

describe("renderTemplate", () => {
  it("substitutes a simple top-level string variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("substitutes a nested-path variable via dotted keys", () => {
    const result = renderTemplate("{{issue.title}}", { issue: { title: "Fix the bug" } });
    expect(result).toBe("Fix the bug");
  });

  it("renders numbers and booleans via String()", () => {
    expect(renderTemplate("{{count}}", { count: 3 })).toBe("3");
    expect(renderTemplate("{{flag}}", { flag: true })).toBe("true");
  });

  it("renders null/undefined values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[]");
  });

  it("JSON.stringifies a plain object value that is not null/string/number/boolean", () => {
    const result = renderTemplate("{{config}}", { config: { nested: true } });
    expect(result).toBe(JSON.stringify({ nested: true }));
  });

  it("leaves the placeholder unresolved when an intermediate path segment is null", () => {
    const result = renderTemplate("{{issue.title}}", { issue: null });
    expect(result).toBe("{{issue.title}}");
  });

  it("leaves the placeholder unresolved when an intermediate path segment is a primitive", () => {
    const result = renderTemplate("{{issue.title.nested}}", { issue: { title: "a string" } });
    expect(result).toBe("{{issue.title.nested}}");
  });

  it("renders a simple array as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["a", "b"] });
    expect(result).toBe("1. a\n2. b");
  });

  it("renders an array of objects as per-key bullet lines", () => {
    const result = renderTemplate("{{steps}}", {
      steps: [{ id: "s1", title: "Step One" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step One");
  });
});

describe("loadPromptTemplate", () => {
  it("loads an existing prompt template file as a non-empty string", () => {
    const content = loadPromptTemplate("planner.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws for a template file that does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});
