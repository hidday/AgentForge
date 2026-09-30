import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("promptRenderer", () => {
  describe("loadPromptTemplate", () => {
    it("reads a real prompt template file from the prompts directory", () => {
      const content = loadPromptTemplate("reviewer.system.md");
      expect(typeof content).toBe("string");
      expect(content.length).toBeGreaterThan(0);
      // sanity check it matches what's actually on disk
      expect(content).toBe(readFileSync(
        new URL("../../src/prompts/reviewer.system.md", import.meta.url),
        "utf-8",
      ));
    });

    it("throws when the template file does not exist", () => {
      expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
    });
  });

  describe("renderTemplate", () => {
    it("substitutes a simple scalar string value", () => {
      expect(renderTemplate("Hello {{name}}", { name: "World" })).toBe("Hello World");
    });

    it("formats a number value via toDisplayString", () => {
      expect(renderTemplate("Count: {{count}}", { count: 42 })).toBe("Count: 42");
    });

    it("formats a boolean value via toDisplayString", () => {
      expect(renderTemplate("Flag: {{flag}}", { flag: true })).toBe("Flag: true");
      expect(renderTemplate("Flag: {{flag}}", { flag: false })).toBe("Flag: false");
    });

    it("renders null and undefined values as an empty string", () => {
      expect(renderTemplate("[{{missing}}]", { missing: null })).toBe("[]");
      expect(renderTemplate("[{{missing}}]", { missing: undefined })).toBe("[]");
    });

    it("JSON-stringifies a plain object value that isn't an array", () => {
      const result = renderTemplate("{{obj}}", { obj: { a: 1, b: "two" } });
      expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
    });

    it("resolves a nested dotted path", () => {
      expect(renderTemplate("{{a.b.c}}", { a: { b: { c: "deep" } } })).toBe("deep");
    });

    it("leaves the placeholder unchanged when an intermediate path segment is not an object", () => {
      expect(renderTemplate("{{a.b.c}}", { a: { b: "not-an-object" } })).toBe("{{a.b.c}}");
    });

    it("leaves the placeholder unchanged when the path resolves through a primitive at the top level", () => {
      expect(renderTemplate("{{a.b}}", { a: 5 })).toBe("{{a.b}}");
    });

    it("leaves the placeholder unchanged when the root path key is missing entirely", () => {
      expect(renderTemplate("{{missingKey.child}}", {})).toBe("{{missingKey.child}}");
    });

    it("renders an array of primitive items as a numbered list", () => {
      const result = renderTemplate("{{items}}", { items: ["a", "b"] });
      expect(result).toBe("1. a\n2. b");
    });

    it("renders an array of objects as bulleted key/value blocks", () => {
      const result = renderTemplate("{{items}}", {
        items: [{ id: "x1", label: "First" }],
      });
      expect(result).toBe("  - id: x1\n  - label: First");
    });

    it("renders an empty array as an empty string", () => {
      expect(renderTemplate("[{{items}}]", { items: [] })).toBe("[]");
    });

    it("handles multiple placeholders in a single template", () => {
      const result = renderTemplate("{{a}} and {{b}}", { a: "one", b: "two" });
      expect(result).toBe("one and two");
    });
  });
});
