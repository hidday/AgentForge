import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads a real prompt template file from the prompts directory", () => {
    const content = loadPromptTemplate("planner.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple top-level string variable", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("substitutes a nested path variable", () => {
    expect(renderTemplate("{{repo.name}}", { repo: { name: "backend" } })).toBe("backend");
  });

  it("leaves the placeholder unresolved when an intermediate path segment is not an object", () => {
    expect(renderTemplate("{{repo.name.deep}}", { repo: { name: "backend" } })).toBe(
      "{{repo.name.deep}}",
    );
  });

  it("renders an empty string when the top-level key is missing (undefined leaf)", () => {
    expect(renderTemplate("{{missing}}", {})).toBe("");
  });

  it("renders null and undefined leaf values as an empty string", () => {
    expect(renderTemplate("[{{a}}][{{b}}]", { a: null, b: undefined })).toBe("[][]");
  });

  it("renders number and boolean leaf values via String()", () => {
    expect(renderTemplate("{{count}} {{flag}}", { count: 3, flag: true })).toBe("3 true");
  });

  it("renders a plain object leaf value as JSON", () => {
    expect(renderTemplate("{{meta}}", { meta: { a: 1 } })).toBe('{"a":1}');
  });

  it("renders an array of primitives as a numbered list", () => {
    expect(renderTemplate("{{items}}", { items: ["a", "b"] })).toBe("1. a\n2. b");
  });

  it("renders an array of objects as bulleted key:value lines", () => {
    const result = renderTemplate("{{steps}}", {
      steps: [{ id: "s1", title: "Step one" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step one");
  });

  it("renders an empty array as an empty string", () => {
    expect(renderTemplate("[{{items}}]", { items: [] })).toBe("[]");
  });

  it("substitutes multiple placeholders in the same template", () => {
    expect(renderTemplate("{{a}}-{{b}}-{{a}}", { a: "x", b: "y" })).toBe("x-y-x");
  });
});
