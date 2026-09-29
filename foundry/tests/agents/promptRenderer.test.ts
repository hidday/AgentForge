import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("promptRenderer", () => {
  describe("loadPromptTemplate", () => {
    it("reads a prompt template file's contents from the prompts directory", () => {
      const template = loadPromptTemplate("reviewer.system.md");

      expect(typeof template).toBe("string");
      expect(template.length).toBeGreaterThan(0);
      expect(template).toContain("code reviewer");
    });

    it("throws when the requested template file does not exist", () => {
      expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
    });
  });

  describe("renderTemplate", () => {
    it("substitutes a simple top-level string variable", () => {
      const result = renderTemplate("Hello {{name}}!", { name: "World" });
      expect(result).toBe("Hello World!");
    });

    it("substitutes a nested-path variable via dot notation", () => {
      const result = renderTemplate("Issue: {{issue.title}}", {
        issue: { title: "Fix the bug" },
      });
      expect(result).toBe("Issue: Fix the bug");
    });

    it("renders numbers and booleans as their string forms", () => {
      const result = renderTemplate("count={{count}} done={{done}}", {
        count: 42,
        done: false,
      });
      expect(result).toBe("count=42 done=false");
    });

    it("renders null and undefined values as an empty string", () => {
      const result = renderTemplate("[{{a}}][{{b}}]", { a: null, b: undefined });
      expect(result).toBe("[][]");
    });

    it("JSON-stringifies a plain object value that isn't null/string/number/boolean/array", () => {
      const result = renderTemplate("checks={{checks}}", {
        checks: { lint: "pass", typecheck: "pass" },
      });
      expect(result).toBe('checks={"lint":"pass","typecheck":"pass"}');
    });

    it("renders a list of objects as a bulleted key/value list", () => {
      const result = renderTemplate("{{steps}}", {
        steps: [
          { id: "s1", title: "Step 1" },
          { id: "s2", title: "Step 2" },
        ],
      });
      expect(result).toBe("  - id: s1\n  - title: Step 1\n  - id: s2\n  - title: Step 2");
    });

    it("renders a list of primitives as a numbered list", () => {
      const result = renderTemplate("{{items}}", { items: ["a", "b", "c"] });
      expect(result).toBe("1. a\n2. b\n3. c");
    });

    it("leaves the placeholder untouched when a path segment resolves through a non-object value", () => {
      const result = renderTemplate("{{plan.summary.nested}}", {
        plan: { summary: "just a string" },
      });
      expect(result).toBe("{{plan.summary.nested}}");
    });

    it("leaves the placeholder untouched when an intermediate path segment is missing entirely", () => {
      const result = renderTemplate("{{issue.missing.value}}", { issue: { title: "x" } });
      expect(result).toBe("{{issue.missing.value}}");
    });
  });
});
