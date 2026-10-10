import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("loads a real template file from the prompts directory", () => {
    const content = loadPromptTemplate("planner.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("loads a different template file with different content", () => {
    const plannerSystem = loadPromptTemplate("planner.system.md");
    const reviewerSystem = loadPromptTemplate("reviewer.system.md");
    expect(reviewerSystem).not.toBe(plannerSystem);
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple string value", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("substitutes a number value via String()", () => {
    expect(renderTemplate("Count: {{count}}", { count: 5 })).toBe("Count: 5");
  });

  it("substitutes a boolean value via String()", () => {
    expect(renderTemplate("Flag: {{flag}}", { flag: true })).toBe("Flag: true");
    expect(renderTemplate("Flag: {{flag}}", { flag: false })).toBe("Flag: false");
  });

  it("renders null or undefined values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", {})).toBe("[]");
    expect(renderTemplate("[{{nullVal}}]", { nullVal: null })).toBe("[]");
  });

  it("JSON-stringifies a plain object value", () => {
    const result = renderTemplate("{{obj}}", { obj: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("resolves a dotted path through nested objects", () => {
    expect(renderTemplate("{{a.b.c}}", { a: { b: { c: "deep" } } })).toBe("deep");
  });

  it("leaves the placeholder untouched when a path segment hits a non-object value", () => {
    expect(renderTemplate("{{a.b}}", { a: "not-an-object" })).toBe("{{a.b}}");
  });

  it("leaves the placeholder untouched when a path segment is null partway through", () => {
    expect(renderTemplate("{{x.y}}", { x: null })).toBe("{{x.y}}");
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{list}}", { list: [1, "two", true] });
    expect(result).toBe("1. 1\n2. two\n3. true");
  });

  it("renders an array of objects as indented key/value bullet lines", () => {
    const result = renderTemplate("{{items}}", { items: [{ id: "s1", title: "Step 1" }] });
    expect(result).toBe("  - id: s1\n  - title: Step 1");
  });

  it("renders a null item inside an array as an empty numbered entry", () => {
    const result = renderTemplate("{{arr}}", { arr: [null, "x"] });
    expect(result).toBe("1. \n2. x");
  });

  it("renders multiple placeholders within the same template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "one", b: "two" });
    expect(result).toBe("one and two");
  });

  it("trims whitespace inside the placeholder braces", () => {
    expect(renderTemplate("{{ name }}", { name: "Trimmed" })).toBe("Trimmed");
  });
});
