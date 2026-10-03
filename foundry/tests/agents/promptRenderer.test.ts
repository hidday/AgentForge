import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("loads an existing prompt template file from src/prompts", () => {
    const content = loadPromptTemplate("planner.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple top-level placeholder", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("substitutes a nested path placeholder", () => {
    const result = renderTemplate("{{issue.title}}", { issue: { title: "Fix bug" } });
    expect(result).toBe("Fix bug");
  });

  it("renders an empty string when a top-level key is simply missing", () => {
    const result = renderTemplate("[{{missing}}]", {});
    expect(result).toBe("[]");
  });

  it("leaves the placeholder untouched when traversing through a null/non-object value", () => {
    const result = renderTemplate("{{a.b.c}}", { a: null });
    expect(result).toBe("{{a.b.c}}");
  });

  it("renders null/undefined values as an empty string", () => {
    expect(renderTemplate("[{{x}}]", { x: null })).toBe("[]");
    expect(renderTemplate("[{{x}}]", { x: undefined })).toBe("[]");
  });

  it("renders numbers and booleans via String()", () => {
    expect(renderTemplate("{{n}}", { n: 42 })).toBe("42");
    expect(renderTemplate("{{b}}", { b: false })).toBe("false");
  });

  it("renders a plain object value as JSON", () => {
    const result = renderTemplate("{{obj}}", { obj: { a: 1 } });
    expect(result).toBe('{"a":1}');
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["a", "b"] });
    expect(result).toBe("1. a\n2. b");
  });

  it("renders an array of objects as bullet lists of their entries", () => {
    const result = renderTemplate("{{steps}}", {
      steps: [{ id: "s1", title: "Step 1" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step 1");
  });

  it("renders an empty array as an empty string", () => {
    const result = renderTemplate("[{{items}}]", { items: [] });
    expect(result).toBe("[]");
  });

  it("replaces multiple distinct placeholders in one template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "1", b: "2" });
    expect(result).toBe("1 and 2");
  });

  it("trims whitespace inside the placeholder braces", () => {
    const result = renderTemplate("{{  name  }}", { name: "trimmed" });
    expect(result).toBe("trimmed");
  });
});
