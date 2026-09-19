import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads a known prompt template file from the prompts directory", () => {
    const content = loadPromptTemplate("reviewer.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple top-level string variable", () => {
    const out = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(out).toBe("Hello World!");
  });

  it("substitutes a nested dotted-path variable", () => {
    const out = renderTemplate("{{repo.name}}", { repo: { name: "acme/backend" } });
    expect(out).toBe("acme/backend");
  });

  it("renders numbers and booleans as their string representation", () => {
    expect(renderTemplate("{{count}}", { count: 3 })).toBe("3");
    expect(renderTemplate("{{ok}}", { ok: true })).toBe("true");
    expect(renderTemplate("{{ok}}", { ok: false })).toBe("false");
  });

  it("renders null and undefined values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[]");
  });

  it("leaves the placeholder literal when an intermediate path segment is missing", () => {
    const out = renderTemplate("{{repo.name}}", {});
    expect(out).toBe("{{repo.name}}");
  });

  it("leaves the placeholder literal when an intermediate path segment is a primitive", () => {
    const out = renderTemplate("{{repo.name}}", { repo: "not-an-object" });
    expect(out).toBe("{{repo.name}}");
  });

  it("renders a JSON string for an object value that has no special-cased shape", () => {
    const out = renderTemplate("{{meta}}", { meta: { a: 1, b: "two" } });
    expect(out).toBe('{"a":1,"b":"two"}');
  });

  it("renders an array of primitives as a numbered list", () => {
    const out = renderTemplate("{{items}}", { items: ["first", "second"] });
    expect(out).toBe("1. first\n2. second");
  });

  it("renders an array of objects as bulleted key/value lines", () => {
    const out = renderTemplate("{{steps}}", {
      steps: [{ id: "s1", title: "Step One" }],
    });
    expect(out).toBe("  - id: s1\n  - title: Step One");
  });

  it("JSON-stringifies a nested object value inside an array-of-objects entry", () => {
    const out = renderTemplate("{{items}}", {
      items: [{ meta: { nested: true } }],
    });
    expect(out).toBe('  - meta: {"nested":true}');
  });

  it("renders an empty array as an empty string", () => {
    const out = renderTemplate("{{items}}", { items: [] });
    expect(out).toBe("");
  });

  it("replaces multiple distinct placeholders in one template", () => {
    const out = renderTemplate("{{a}} and {{b}}", { a: "1", b: "2" });
    expect(out).toBe("1 and 2");
  });

  it("trims whitespace inside the placeholder braces", () => {
    const out = renderTemplate("{{ name }}", { name: "Trimmed" });
    expect(out).toBe("Trimmed");
  });
});
