import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate()", () => {
  it("reads a real prompt template file's contents from disk", () => {
    const content = loadPromptTemplate("reviewer.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the requested template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate()", () => {
  it("leaves a placeholder unchanged when an intermediate path segment is not an object", () => {
    const result = renderTemplate("Value: {{summary.detail}}", { summary: "just a string" });
    expect(result).toBe("Value: {{summary.detail}}");
  });

  it("leaves a placeholder unchanged when an intermediate path segment is null", () => {
    const result = renderTemplate("Value: {{missing.detail}}", { missing: null });
    expect(result).toBe("Value: {{missing.detail}}");
  });

  it("substitutes a simple top-level string variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("resolves a nested object path", () => {
    const result = renderTemplate("{{repo.name}}", { repo: { name: "test-repo" } });
    expect(result).toBe("test-repo");
  });

  it("renders an empty string for a null or undefined top-level value", () => {
    expect(renderTemplate("[{{x}}]", { x: null })).toBe("[]");
    expect(renderTemplate("[{{x}}]", { x: undefined })).toBe("[]");
  });

  it("renders numbers and booleans via String()", () => {
    expect(renderTemplate("{{count}}", { count: 3 })).toBe("3");
    expect(renderTemplate("{{flag}}", { flag: true })).toBe("true");
  });

  it("JSON-stringifies an object field nested inside an array item", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ label: "step1", meta: { nested: 1, ok: true } }],
    });
    expect(result).toContain("- label: step1");
    expect(result).toContain(`- meta: ${JSON.stringify({ nested: 1, ok: true })}`);
  });

  it("renders an array of plain strings as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["a", "b"] });
    expect(result).toBe("1. a\n2. b");
  });
});
