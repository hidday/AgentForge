import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads a real prompt template file from src/prompts and returns its contents", () => {
    const text = loadPromptTemplate("planner.system.md");
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple top-level string value", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("substitutes a nested dotted-path value", () => {
    const result = renderTemplate("Repo: {{repo.name}}", { repo: { name: "foundry" } });
    expect(result).toBe("Repo: foundry");
  });

  it("renders numbers and booleans via String() coercion", () => {
    const result = renderTemplate("priority={{priority}} active={{active}}", {
      priority: 2,
      active: true,
    });
    expect(result).toBe("priority=2 active=true");
  });

  it("renders null/undefined values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", {})).toBe("[]");
  });

  it("JSON-stringifies a plain object value that isn't an array", () => {
    const result = renderTemplate("{{obj}}", { obj: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("renders an array of primitive values as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["first", "second"] });
    expect(result).toBe("1. first\n2. second");
  });

  it("renders an array of objects as bullet lists of their entries", () => {
    const result = renderTemplate("{{steps}}", {
      steps: [{ id: "s1", title: "Step One" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step One");
  });

  it("leaves the placeholder unchanged when a dotted path traverses through a non-object value", () => {
    const result = renderTemplate("{{a.b}}", { a: "just a string" });
    expect(result).toBe("{{a.b}}");
  });

  it("leaves the placeholder unchanged when the path resolves through a null intermediate value", () => {
    const result = renderTemplate("{{a.b.c}}", { a: { b: null } });
    expect(result).toBe("{{a.b.c}}");
  });

  it("replaces multiple distinct placeholders in the same template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "one", b: "two" });
    expect(result).toBe("one and two");
  });
});
