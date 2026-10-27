import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/agents/promptRenderer.js";

describe("renderTemplate", () => {
  it("substitutes simple top-level variables", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("substitutes nested dotted-path variables", () => {
    const result = renderTemplate("{{a.b.c}}", { a: { b: { c: "deep value" } } });
    expect(result).toBe("deep value");
  });

  it("renders number and boolean values as their string form", () => {
    const result = renderTemplate("{{count}} / {{flag}}", { count: 42, flag: true });
    expect(result).toBe("42 / true");
  });

  it("renders null/undefined values as an empty string", () => {
    const result = renderTemplate("[{{missingTopLevel}}][{{nullVal}}]", {
      nullVal: null,
    });
    expect(result).toBe("[][]");
  });

  it("renders a plain object value via JSON.stringify", () => {
    const result = renderTemplate("{{obj}}", { obj: { foo: "bar", n: 1 } });
    expect(result).toBe(JSON.stringify({ foo: "bar", n: 1 }));
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["a", "b"] });
    expect(result).toBe("1. a\n2. b");
  });

  it("renders an array of objects as bulleted key/value entries", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "s1", title: "Step 1" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step 1");
  });

  it("renders an array element that is itself an object with a nested-object field via JSON.stringify", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "s1", meta: { nested: true } }],
    });
    expect(result).toContain(`  - id: s1`);
    expect(result).toContain(`  - meta: ${JSON.stringify({ nested: true })}`);
  });

  it("leaves the placeholder unresolved when an intermediate path segment is not an object", () => {
    const result = renderTemplate("{{a.b.c}}", { a: { b: "not an object" } });
    expect(result).toBe("{{a.b.c}}");
  });

  it("leaves the placeholder unresolved when a shallow (depth-2) path hits a non-object value", () => {
    const result = renderTemplate("{{a.b}}", { a: "plain string" });
    expect(result).toBe("{{a.b}}");
  });

  it("supports multiple placeholders in the same template", () => {
    const result = renderTemplate("{{x}}-{{y}}-{{x}}", { x: "1", y: "2" });
    expect(result).toBe("1-2-1");
  });
});
