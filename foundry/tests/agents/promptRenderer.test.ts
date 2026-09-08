import { describe, it, expect } from "vitest";
import { renderTemplate, loadPromptTemplate } from "../../src/agents/promptRenderer.js";

describe("renderTemplate", () => {
  it("substitutes a simple top-level string variable", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("substitutes a nested dotted-path variable", () => {
    expect(renderTemplate("{{repo.name}}", { repo: { name: "acme/backend" } })).toBe(
      "acme/backend",
    );
  });

  it("renders numbers and booleans via String() coercion", () => {
    expect(renderTemplate("{{count}}", { count: 42 })).toBe("42");
    expect(renderTemplate("{{ok}}", { ok: true })).toBe("true");
    expect(renderTemplate("{{ok}}", { ok: false })).toBe("false");
  });

  it("renders null and undefined as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[]");
  });

  it("JSON-stringifies plain objects that aren't arrays", () => {
    const result = renderTemplate("{{meta}}", { meta: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("leaves the placeholder untouched when the path resolves through a non-object value", () => {
    // `flag` is a boolean, so `flag.nested` cannot be traversed further --
    // the renderer should bail out and return the original placeholder text.
    const result = renderTemplate("{{flag.nested}}", { flag: true });
    expect(result).toBe("{{flag.nested}}");
  });

  it("leaves the placeholder untouched when an intermediate path segment is missing", () => {
    const result = renderTemplate("{{a.b.c}}", { a: {} });
    expect(result).toBe("{{a.b.c}}");
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["one", "two"] });
    expect(result).toBe("1. one\n2. two");
  });

  it("renders an array of objects as bulleted key/value lines", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "a", count: 3 }],
    });
    expect(result).toBe("  - id: a\n  - count: 3");
  });

  it("renders an empty array as an empty string", () => {
    expect(renderTemplate("[{{items}}]", { items: [] })).toBe("[]");
  });

  it("trims whitespace inside the placeholder braces", () => {
    expect(renderTemplate("{{ name }}", { name: "Trimmed" })).toBe("Trimmed");
  });

  it("replaces multiple distinct placeholders in one template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "x", b: "y" });
    expect(result).toBe("x and y");
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
