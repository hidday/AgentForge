import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("loadPromptTemplate", () => {
  it("reads a real prompt file from the prompts directory", () => {
    const content = loadPromptTemplate("planner.system.md");
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });
});

describe("renderTemplate", () => {
  it("substitutes a simple string variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("resolves a nested path through multiple levels", () => {
    const result = renderTemplate("{{repo.name}}", { repo: { name: "my-repo" } });
    expect(result).toBe("my-repo");
  });

  it("renders numbers and booleans via String()", () => {
    const result = renderTemplate("{{count}} / {{active}}", { count: 42, active: true });
    expect(result).toBe("42 / true");
  });

  it("renders null or undefined values as an empty string", () => {
    const result = renderTemplate("[{{missing}}][{{isNull}}]", {
      missing: undefined,
      isNull: null,
    });
    expect(result).toBe("[][]");
  });

  it("renders a plain object value via JSON.stringify", () => {
    const result = renderTemplate("{{meta}}", { meta: { a: 1, b: "two" } });
    expect(result).toBe(JSON.stringify({ a: 1, b: "two" }));
  });

  it("leaves the placeholder unchanged when an intermediate path segment is missing", () => {
    const result = renderTemplate("{{repo.owner.name}}", { repo: {} });
    expect(result).toBe("{{repo.owner.name}}");
  });

  it("leaves the placeholder unchanged when an intermediate path segment is a primitive", () => {
    const result = renderTemplate("{{repo.name.nested}}", { repo: { name: "my-repo" } });
    expect(result).toBe("{{repo.name.nested}}");
  });

  it("renders an array of primitives as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["a", "b", "c"] });
    expect(result).toBe("1. a\n2. b\n3. c");
  });

  it("renders an array of objects as bulleted key/value lines, joined per item", () => {
    const result = renderTemplate("{{steps}}", {
      steps: [
        { id: "s1", title: "First" },
        { id: "s2", title: "Second" },
      ],
    });
    expect(result).toBe("  - id: s1\n  - title: First\n  - id: s2\n  - title: Second");
  });

  it("renders an empty array as an empty string", () => {
    const result = renderTemplate("[{{items}}]", { items: [] });
    expect(result).toBe("[]");
  });

  it("leaves non-matching text untouched and substitutes multiple placeholders", () => {
    const result = renderTemplate("{{a}} and {{b}}, plus plain text.", { a: "X", b: "Y" });
    expect(result).toBe("X and Y, plus plain text.");
  });
});
