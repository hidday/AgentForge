import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, "../../src/prompts");

describe("loadPromptTemplate", () => {
  it("reads the raw contents of a template file from the prompts directory", () => {
    const expected = readFileSync(resolve(PROMPTS_DIR, "planner.system.md"), "utf-8");
    expect(loadPromptTemplate("planner.system.md")).toBe(expected);
  });

  it("throws when the template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple top-level string variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("substitutes a nested variable via dotted path", () => {
    const result = renderTemplate("Repo: {{repo.name}}", { repo: { name: "acme/backend" } });
    expect(result).toBe("Repo: acme/backend");
  });

  it("leaves the placeholder untouched when the path resolves to undefined partway through", () => {
    const result = renderTemplate("Value: {{repo.missing.deep}}", { repo: { missing: undefined } });
    expect(result).toBe("Value: {{repo.missing.deep}}");
  });

  it("leaves the placeholder untouched when an intermediate value is not an object", () => {
    const result = renderTemplate("Value: {{repo.name.deep}}", { repo: { name: "acme" } });
    expect(result).toBe("Value: {{repo.name.deep}}");
  });

  it("renders an empty string when the top-level key is entirely missing (not a preserved placeholder)", () => {
    const result = renderTemplate("Value: {{doesNotExist}}", {});
    expect(result).toBe("Value: ");
  });

  it("renders null/undefined top-level values as an empty string", () => {
    expect(renderTemplate("[{{a}}]", { a: null })).toBe("[]");
    expect(renderTemplate("[{{a}}]", { a: undefined })).toBe("[]");
  });

  it("renders number and boolean values via String()", () => {
    expect(renderTemplate("[{{n}}]", { n: 42 })).toBe("[42]");
    expect(renderTemplate("[{{b}}]", { b: false })).toBe("[false]");
  });

  it("renders a plain object value as JSON", () => {
    const result = renderTemplate("[{{obj}}]", { obj: { a: 1 } });
    expect(result).toBe(`[${JSON.stringify({ a: 1 })}]`);
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["first", "second"] });
    expect(result).toBe("1. first\n2. second");
  });

  it("renders an array of objects as bulleted key/value pairs per item", () => {
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
    const result = renderTemplate("{{a}} and {{b}}", { a: "one", b: "two" });
    expect(result).toBe("one and two");
  });
});
