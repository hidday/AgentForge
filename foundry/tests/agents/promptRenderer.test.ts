import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads a real template file from the prompts directory", () => {
    const content = loadPromptTemplate("planner.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a top-level scalar value", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("substitutes a nested path value", () => {
    expect(renderTemplate("{{repo.name}}", { repo: { name: "acme/repo" } })).toBe("acme/repo");
  });

  it("renders numbers and booleans as their string form", () => {
    expect(renderTemplate("{{count}}", { count: 5 })).toBe("5");
    expect(renderTemplate("{{flag}}", { flag: true })).toBe("true");
  });

  it("renders null/undefined values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", {})).toBe("[]");
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["a", "b"] });
    expect(result).toBe("1. a\n2. b");
  });

  it("renders an array of objects as bulleted key:value pairs", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "s1", title: "Step" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step");
  });

  it("JSON-stringifies an object value nested inside an array item", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ meta: { nested: "x" } }],
    });
    expect(result).toBe('  - meta: {"nested":"x"}');
  });

  it("leaves the placeholder literally unresolved when an intermediate path segment is not an object", () => {
    const result = renderTemplate("{{repo.name}}", { repo: "just-a-string" });
    expect(result).toBe("{{repo.name}}");
  });

  it("leaves the placeholder literally unresolved when an intermediate path segment is null", () => {
    const result = renderTemplate("{{repo.name}}", { repo: null });
    expect(result).toBe("{{repo.name}}");
  });

  it("substitutes multiple placeholders in the same template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "1", b: "2" });
    expect(result).toBe("1 and 2");
  });
});
