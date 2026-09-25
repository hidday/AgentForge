import { describe, it, expect } from "vitest";
import { renderTemplate, loadPromptTemplate } from "../../src/agents/promptRenderer.js";

describe("renderTemplate", () => {
  it("substitutes a simple string variable", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("stringifies numbers and booleans", () => {
    expect(renderTemplate("{{count}} / {{active}}", { count: 3, active: true })).toBe("3 / true");
  });

  it("renders null and undefined leaf values as an empty string", () => {
    expect(renderTemplate("[{{missing}}][{{isNull}}]", { missing: undefined, isNull: null })).toBe(
      "[][]",
    );
  });

  it("resolves nested dotted paths", () => {
    expect(renderTemplate("{{repo.name}}", { repo: { name: "acme/backend-api" } })).toBe(
      "acme/backend-api",
    );
  });

  it("leaves the placeholder untouched when the path traverses through a non-object value", () => {
    // vars.foo is a primitive string, so `{{foo.bar}}` cannot descend into it.
    expect(renderTemplate("{{foo.bar}}", { foo: "just a string" })).toBe("{{foo.bar}}");
  });

  it("leaves the placeholder untouched when an intermediate key is missing entirely", () => {
    expect(renderTemplate("{{missing.nested}}", {})).toBe("{{missing.nested}}");
  });

  it("JSON-stringifies a plain object leaf value", () => {
    const result = renderTemplate("{{obj}}", { obj: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["first", "second"] });
    expect(result).toBe("1. first\n2. second");
  });

  it("renders an array of objects as bulleted key/value blocks", () => {
    const result = renderTemplate("{{steps}}", {
      steps: [{ id: "s1", title: "Step 1" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step 1");
  });

  it("renders an empty array as an empty string", () => {
    expect(renderTemplate("[{{items}}]", { items: [] })).toBe("[]");
  });

  it("replaces multiple distinct placeholders in one template", () => {
    const result = renderTemplate("{{a}}-{{b}}-{{a}}", { a: "x", b: "y" });
    expect(result).toBe("x-y-x");
  });
});

describe("loadPromptTemplate", () => {
  it("reads an existing prompt template file as a non-empty string", () => {
    const content = loadPromptTemplate("planner.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws for a template file that does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});
