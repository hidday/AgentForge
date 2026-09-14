import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads a real prompt template file from the prompts directory", () => {
    const contents = loadPromptTemplate("planner.system.md");
    expect(typeof contents).toBe("string");
    expect(contents.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes simple string values", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("substitutes nested dotted paths", () => {
    expect(renderTemplate("{{a.b.c}}", { a: { b: { c: "deep" } } })).toBe("deep");
  });

  it("leaves the placeholder unresolved when an intermediate path segment is not an object", () => {
    expect(renderTemplate("{{a.b.c}}", { a: { b: "not-an-object" } })).toBe("{{a.b.c}}");
  });

  it("leaves the placeholder unresolved when a path segment is missing entirely", () => {
    expect(renderTemplate("{{missing.path}}", {})).toBe("{{missing.path}}");
  });

  it("renders numbers and booleans as their string form", () => {
    expect(renderTemplate("{{n}} {{b}}", { n: 42, b: true })).toBe("42 true");
  });

  it("renders null and undefined as an empty string", () => {
    expect(renderTemplate("[{{n}}][{{u}}]", { n: null, u: undefined })).toBe("[][]");
  });

  it("renders a plain object value as its JSON representation (toDisplayString fallback)", () => {
    const out = renderTemplate("{{obj}}", { obj: { foo: "bar", n: 1 } });
    expect(out).toBe(JSON.stringify({ foo: "bar", n: 1 }));
  });

  it("renders an array of primitives as a numbered list", () => {
    const out = renderTemplate("{{items}}", { items: ["a", "b", "c"] });
    expect(out).toBe("1. a\n2. b\n3. c");
  });

  it("renders an array of objects as nested bullet lists of their fields", () => {
    const out = renderTemplate("{{items}}", {
      items: [
        { id: "s1", title: "Step 1" },
        { id: "s2", title: "Step 2" },
      ],
    });
    expect(out).toBe(
      "  - id: s1\n  - title: Step 1\n  - id: s2\n  - title: Step 2",
    );
  });

  it("stringifies nested object/array field values within an array-of-objects render", () => {
    const out = renderTemplate("{{items}}", {
      items: [{ id: "s1", tags: ["x", "y"] }],
    });
    expect(out).toBe(`  - id: s1\n  - tags: ${JSON.stringify(["x", "y"])}`);
  });

  it("renders an empty array as an empty string", () => {
    expect(renderTemplate("[{{items}}]", { items: [] })).toBe("[]");
  });

  it("replaces multiple distinct placeholders in one template", () => {
    const out = renderTemplate("{{a}} and {{b}}", { a: "x", b: "y" });
    expect(out).toBe("x and y");
  });

  it("trims surrounding whitespace inside the placeholder braces", () => {
    expect(renderTemplate("{{ name }}", { name: "Trimmed" })).toBe("Trimmed");
  });
});
