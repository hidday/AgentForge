import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/agents/promptRenderer.js";

describe("renderTemplate", () => {
  it("substitutes a simple string value", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "World" })).toBe("Hello World!");
  });

  it("substitutes a nested path value", () => {
    expect(renderTemplate("{{repo.name}}", { repo: { name: "acme/widgets" } })).toBe(
      "acme/widgets",
    );
  });

  it("stringifies numbers and booleans directly", () => {
    expect(renderTemplate("{{count}} {{flag}}", { count: 3, flag: true })).toBe("3 true");
  });

  it("replaces null or undefined values with an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[]");
  });

  it("JSON-stringifies a plain object value that isn't an array", () => {
    const result = renderTemplate("{{meta}}", { meta: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["first", "second"] });
    expect(result).toBe("1. first\n2. second");
  });

  it("renders an array of objects as bulleted key/value pairs", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "s1", title: "Step One" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step One");
  });

  it("leaves the placeholder unchanged when a mid-path segment is not an object", () => {
    const result = renderTemplate("{{repo.name}}", { repo: "not-an-object" });
    expect(result).toBe("{{repo.name}}");
  });

  it("leaves the placeholder unchanged when a mid-path segment is null", () => {
    const result = renderTemplate("{{repo.name}}", { repo: null });
    expect(result).toBe("{{repo.name}}");
  });

  it("trims whitespace inside the placeholder braces", () => {
    expect(renderTemplate("{{ name }}", { name: "Trimmed" })).toBe("Trimmed");
  });

  it("replaces every occurrence of the same placeholder", () => {
    expect(renderTemplate("{{x}}-{{x}}", { x: "a" })).toBe("a-a");
  });
});
