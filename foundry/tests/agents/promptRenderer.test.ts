import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads a real prompt template file from the prompts directory", () => {
    const template = loadPromptTemplate("reviewer.system.md");

    expect(typeof template).toBe("string");
    expect(template.length).toBeGreaterThan(0);
  });

  it("throws when the requested template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple scalar string variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });

    expect(result).toBe("Hello World!");
  });

  it("substitutes nested object paths", () => {
    const result = renderTemplate("Repo: {{repo.name}}", { repo: { name: "foundry" } });

    expect(result).toBe("Repo: foundry");
  });

  it("stringifies number and boolean values", () => {
    const result = renderTemplate("count={{count}} active={{active}}", {
      count: 3,
      active: true,
    });

    expect(result).toBe("count=3 active=true");
  });

  it("renders null/undefined scalar values as an empty string", () => {
    const result = renderTemplate("value=[{{missing}}]", { missing: null });

    expect(result).toBe("value=[]");
  });

  it("falls back to JSON.stringify for a plain object value (not an array)", () => {
    const result = renderTemplate("plan={{plan}}", { plan: { planVersion: 1, summary: "x" } });

    expect(result).toBe('plan={"planVersion":1,"summary":"x"}');
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["a", "b", "c"] });

    expect(result).toBe("1. a\n2. b\n3. c");
  });

  it("renders an array of objects as bulleted key/value lines", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "s1", title: "Step 1" }],
    });

    expect(result).toBe("  - id: s1\n  - title: Step 1");
  });

  it("stringifies nested object values inside array-of-object entries", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "s1", meta: { a: 1 } }],
    });

    expect(result).toBe('  - id: s1\n  - meta: {"a":1}');
  });

  it("leaves the placeholder literal unchanged when a top-level key is missing", () => {
    const result = renderTemplate("{{foo.bar}}", { foo: undefined });

    expect(result).toBe("{{foo.bar}}");
  });

  it("leaves the placeholder literal unchanged when traversal hits a non-object deep in the path", () => {
    const result = renderTemplate("{{issue.nonexistent.deep}}", { issue: {} });

    expect(result).toBe("{{issue.nonexistent.deep}}");
  });

  it("trims whitespace inside the placeholder braces", () => {
    const result = renderTemplate("{{ name }}", { name: "World" });

    expect(result).toBe("World");
  });
});
