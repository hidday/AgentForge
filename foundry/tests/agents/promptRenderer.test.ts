import { describe, it, expect } from "vitest";
import { renderTemplate, loadPromptTemplate } from "../../src/agents/promptRenderer.js";

describe("promptRenderer", () => {
  describe("loadPromptTemplate", () => {
    it("loads an existing prompt template file from the prompts directory", () => {
      const content = loadPromptTemplate("planner.system.md");
      expect(typeof content).toBe("string");
      expect(content.length).toBeGreaterThan(0);
    });

    it("throws when the template file does not exist", () => {
      expect(() => loadPromptTemplate("this-file-does-not-exist.md")).toThrow();
    });
  });

  describe("renderTemplate", () => {
    it("substitutes a simple top-level string variable", () => {
      const result = renderTemplate("Hello {{name}}!", { name: "World" });
      expect(result).toBe("Hello World!");
    });

    it("substitutes a nested dotted-path variable", () => {
      const result = renderTemplate("Repo: {{repo.name}}", { repo: { name: "test-repo" } });
      expect(result).toBe("Repo: test-repo");
    });

    it("renders numbers and booleans via toDisplayString", () => {
      const result = renderTemplate("count={{count}} active={{active}}", {
        count: 42,
        active: true,
      });
      expect(result).toBe("count=42 active=true");
    });

    it("renders null/undefined leaf values as an empty string", () => {
      const result = renderTemplate("value=[{{value}}]", { value: null });
      expect(result).toBe("value=[]");

      const result2 = renderTemplate("value=[{{value}}]", { value: undefined });
      expect(result2).toBe("value=[]");
    });

    it("JSON-stringifies a plain object leaf value", () => {
      const result = renderTemplate("obj={{obj}}", { obj: { a: 1, b: "x" } });
      expect(result).toBe('obj={"a":1,"b":"x"}');
    });

    it("leaves the placeholder untouched when an intermediate path segment is missing", () => {
      const result = renderTemplate("{{repo.name}}", { other: "value" });
      expect(result).toBe("{{repo.name}}");
    });

    it("leaves the placeholder untouched when an intermediate path segment is a primitive, not an object", () => {
      // "repo" resolves to a string, so ".name" cannot be traversed further.
      const result = renderTemplate("{{repo.name}}", { repo: "not-an-object" });
      expect(result).toBe("{{repo.name}}");
    });

    it("renders an array of primitives as a numbered list", () => {
      const result = renderTemplate("{{items}}", { items: ["a", "b", "c"] });
      expect(result).toBe("1. a\n2. b\n3. c");
    });

    it("renders an array of objects as bulleted key/value entries", () => {
      const result = renderTemplate("{{items}}", {
        items: [{ id: "s1", title: "Step 1" }],
      });
      expect(result).toBe("  - id: s1\n  - title: Step 1");
    });

    it("renders an empty array as an empty string", () => {
      const result = renderTemplate("[{{items}}]", { items: [] });
      expect(result).toBe("[]");
    });

    it("replaces multiple distinct placeholders in the same template", () => {
      const result = renderTemplate("{{a}} and {{b}}", { a: "1", b: "2" });
      expect(result).toBe("1 and 2");
    });
  });
});
