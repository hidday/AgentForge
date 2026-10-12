import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads a real prompt file from the prompts directory as utf-8 text", () => {
    const content = loadPromptTemplate("answer-researcher.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws when the requested prompt file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate", () => {
  it("substitutes simple string and number/boolean variables", () => {
    const result = renderTemplate("Hello {{name}}, you are {{age}} and active={{active}}", {
      name: "World",
      age: 42,
      active: true,
    });
    expect(result).toBe("Hello World, you are 42 and active=true");
  });

  it("renders null/undefined variables as an empty string", () => {
    expect(renderTemplate("[{{missingNull}}][{{missingUndef}}]", {
      missingNull: null,
      missingUndef: undefined,
    })).toBe("[][]");
  });

  it("JSON-stringifies plain object values that aren't arrays", () => {
    const result = renderTemplate("{{obj}}", { obj: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("renders an array of primitive items as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["first", "second", "third"] });
    expect(result).toBe("1. first\n2. second\n3. third");
  });

  it("renders an array of objects as bullet key/value lines", () => {
    const result = renderTemplate("{{items}}", {
      items: [{ id: "s1", title: "Step 1" }],
    });
    expect(result).toBe("  - id: s1\n  - title: Step 1");
  });

  it("leaves the placeholder untouched when a dotted path cannot be resolved (non-object midway)", () => {
    const result = renderTemplate("{{issue.title}}", { issue: "not-an-object" });
    expect(result).toBe("{{issue.title}}");
  });

  it("renders an empty string (not the placeholder) when a top-level key is simply missing", () => {
    // A single-segment path never hits the "intermediate value isn't an
    // object" guard -- it resolves to `undefined` and renders as "".
    const result = renderTemplate("{{doesNotExist}}", {});
    expect(result).toBe("");
  });

  it("resolves nested dotted paths against nested objects", () => {
    const result = renderTemplate("{{issue.title}}", { issue: { title: "Nested title" } });
    expect(result).toBe("Nested title");
  });
});
