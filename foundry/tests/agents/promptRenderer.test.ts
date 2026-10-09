import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("agents/promptRenderer", () => {
  describe("loadPromptTemplate", () => {
    it("loads a real template file from the prompts directory", () => {
      const content = loadPromptTemplate("reviewer.system.md");
      expect(typeof content).toBe("string");
      expect(content.length).toBeGreaterThan(0);
    });

    it("throws when the template file does not exist", () => {
      expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
    });
  });

  describe("renderTemplate", () => {
    it("substitutes a simple top-level variable", () => {
      const result = renderTemplate("Hello {{name}}!", { name: "World" });
      expect(result).toBe("Hello World!");
    });

    it("substitutes a nested path variable", () => {
      const result = renderTemplate("{{issue.title}}", { issue: { title: "Fix the bug" } });
      expect(result).toBe("Fix the bug");
    });

    it("leaves the placeholder as-is when an intermediate path segment is not an object", () => {
      const result = renderTemplate("{{issue.title.nested}}", { issue: { title: "a string" } });
      expect(result).toBe("{{issue.title.nested}}");
    });

    it("renders an empty string when the top-level key is missing (resolves to undefined)", () => {
      const result = renderTemplate("[{{missing}}]", {});
      expect(result).toBe("[]");
    });

    it("leaves the placeholder as-is when a deeper path segment is missing on a non-object value", () => {
      const result = renderTemplate("{{a.b.c}}", { a: { b: "leaf" } });
      expect(result).toBe("{{a.b.c}}");
    });

    it("renders null/undefined values as an empty string", () => {
      expect(renderTemplate("[{{a}}]", { a: null })).toBe("[]");
      expect(renderTemplate("[{{a}}]", { a: undefined })).toBe("[]");
    });

    it("renders numbers and booleans via String()", () => {
      expect(renderTemplate("{{count}}", { count: 42 })).toBe("42");
      expect(renderTemplate("{{flag}}", { flag: true })).toBe("true");
    });

    it("JSON-stringifies a value that isn't a string/number/boolean/null (e.g. a nested object)", () => {
      const result = renderTemplate("{{obj}}", { obj: { a: 1 } });
      expect(result).toBe(JSON.stringify({ a: 1 }));
    });

    it("renders an array of primitives as a numbered list", () => {
      const result = renderTemplate("{{items}}", { items: ["a", "b", "c"] });
      expect(result).toBe("1. a\n2. b\n3. c");
    });

    it("renders an empty array as an empty string", () => {
      const result = renderTemplate("{{items}}", { items: [] });
      expect(result).toBe("");
    });

    it("renders an array of objects as bulleted key/value pairs", () => {
      const result = renderTemplate("{{steps}}", {
        steps: [{ id: "s1", title: "Step 1" }],
      });
      expect(result).toBe("  - id: s1\n  - title: Step 1");
    });

    it("JSON-stringifies nested non-primitive values inside object entries", () => {
      const result = renderTemplate("{{steps}}", {
        steps: [{ id: "s1", nested: { x: 1 } }],
      });
      expect(result).toContain(`  - nested: ${JSON.stringify({ x: 1 })}`);
    });

    it("replaces multiple distinct placeholders in one template", () => {
      const result = renderTemplate("{{a}} and {{b}}", { a: "foo", b: "bar" });
      expect(result).toBe("foo and bar");
    });
  });
});
