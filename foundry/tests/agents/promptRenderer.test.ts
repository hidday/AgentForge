import { describe, it, expect } from "vitest";
import { renderTemplate, loadPromptTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads a real prompt template file from src/prompts", () => {
    const content = loadPromptTemplate("planner.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple top-level string variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("substitutes a nested dotted-path variable", () => {
    const result = renderTemplate("Repo: {{repo.name}}", { repo: { name: "acme/backend" } });
    expect(result).toBe("Repo: acme/backend");
  });

  it("leaves the placeholder unchanged when a top-level key does not exist", () => {
    const result = renderTemplate("Value: {{missingKey}}", {});
    expect(result).toBe("Value: {{missingKey}}");
  });

  it("leaves the placeholder unchanged when a nested path traverses through null/undefined", () => {
    const result = renderTemplate("Value: {{a.b.c}}", { a: { b: null } });
    expect(result).toBe("Value: {{a.b.c}}");
  });

  it("leaves the placeholder unchanged when a nested path traverses through a non-object", () => {
    const result = renderTemplate("Value: {{a.b}}", { a: "just a string" });
    expect(result).toBe("Value: {{a.b}}");
  });

  it("renders numbers and booleans via String()", () => {
    expect(renderTemplate("{{count}}", { count: 3 })).toBe("3");
    expect(renderTemplate("{{flag}}", { flag: true })).toBe("true");
  });

  it("renders null/undefined values as an empty string", () => {
    expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
    expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[{{missing}}]");
  });

  it("JSON-stringifies a plain object value that isn't handled by a more specific branch", () => {
    const result = renderTemplate("{{obj}}", { obj: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("renders an array of primitive items as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["one", "two"] });
    expect(result).toBe("1. one\n2. two");
  });

  it("renders an array of objects as bulleted key: value lines", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "s1", title: "Step 1" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step 1");
  });

  it("renders an empty array as an empty string", () => {
    const result = renderTemplate("[{{items}}]", { items: [] });
    expect(result).toBe("[]");
  });

  it("replaces multiple distinct placeholders in one template", () => {
    const result = renderTemplate("{{a}} and {{b}}", { a: "X", b: "Y" });
    expect(result).toBe("X and Y");
  });
});
