import { describe, it, expect } from "vitest";
import { renderTemplate, loadPromptTemplate } from "../../src/agents/promptRenderer.js";

describe("renderTemplate", () => {
  it("substitutes a simple top-level variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("substitutes a nested dotted-path variable", () => {
    const result = renderTemplate("Repo: {{repo.name}}", { repo: { name: "agentforge" } });
    expect(result).toBe("Repo: agentforge");
  });

  it("leaves the placeholder untouched when an intermediate path segment is missing", () => {
    const result = renderTemplate("{{repo.owner.login}}", { repo: { name: "agentforge" } });
    expect(result).toBe("{{repo.owner.login}}");
  });

  it("leaves the placeholder untouched when the top-level key is missing", () => {
    const result = renderTemplate("{{missing.path}}", { other: 1 });
    expect(result).toBe("{{missing.path}}");
  });

  it("renders null and undefined values as an empty string", () => {
    expect(renderTemplate("[{{a}}]", { a: null })).toBe("[]");
    expect(renderTemplate("[{{a}}]", { a: undefined })).toBe("[]");
  });

  it("renders numbers and booleans via String()", () => {
    expect(renderTemplate("{{n}}/{{b}}", { n: 42, b: false })).toBe("42/false");
  });

  it("JSON-stringifies a plain object value", () => {
    const result = renderTemplate("{{obj}}", { obj: { x: 1 } });
    expect(result).toBe(JSON.stringify({ x: 1 }));
  });

  it("renders an array of scalars as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["a", "b"] });
    expect(result).toBe("1. a\n2. b");
  });

  it("renders an array of objects as bullet key/value lines", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "s1", title: "Step 1" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step 1");
  });

  it("JSON-stringifies object values nested inside an array-of-objects entry", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ meta: { nested: true } }],
    });
    expect(result).toBe(`  - meta: ${JSON.stringify({ nested: true })}`);
  });

  it("replaces multiple distinct placeholders in one template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "x", b: "y" });
    expect(result).toBe("x and y");
  });
});

describe("loadPromptTemplate", () => {
  it("reads a known prompt file from the prompts directory", () => {
    const content = loadPromptTemplate("reviewer.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});
