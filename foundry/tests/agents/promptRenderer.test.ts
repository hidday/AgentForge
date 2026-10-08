import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

describe("renderTemplate", () => {
  it("substitutes top-level and nested dotted paths, trimming whitespace in the placeholder", () => {
    expect(
      renderTemplate("Issue {{ issue.id }}: {{issue.title}} in {{repo}}", {
        issue: { id: "ENG-1", title: "Fix" },
        repo: "org/repo",
      }),
    ).toBe("Issue ENG-1: Fix in org/repo");
  });

  it("renders numbers and booleans via String()", () => {
    expect(renderTemplate("{{n}}|{{zero}}|{{t}}|{{f}}", { n: 42, zero: 0, t: true, f: false })).toBe(
      "42|0|true|false",
    );
  });

  it("renders null and undefined leaf values as empty strings", () => {
    expect(renderTemplate("[{{a}}][{{b}}][{{c.d}}]", { a: null, b: undefined, c: { d: null } })).toBe(
      "[][][]",
    );
  });

  it("JSON-encodes plain object leaf values", () => {
    expect(renderTemplate("{{cfg}}", { cfg: { a: 1, b: ["x"] } })).toBe('{"a":1,"b":["x"]}');
  });

  it("leaves the placeholder intact when traversal hits a null intermediate", () => {
    expect(renderTemplate("x {{ a.b.c }} y", { a: null })).toBe("x {{a.b.c}} y");
  });

  it("leaves the placeholder intact when traversal hits a primitive intermediate", () => {
    expect(renderTemplate("{{name.length}}", { name: "abc" })).toBe("{{name.length}}");
  });

  it("renders a missing top-level key as an empty string", () => {
    expect(renderTemplate("<{{missing}}>", {})).toBe("<>");
  });

  it("renders primitive arrays as a numbered list using display formatting", () => {
    expect(renderTemplate("{{items}}", { items: ["alpha", 2, null, { k: 1 }] })).toBe(
      "1. alpha\n2. 2\n3. \n  - k: 1",
    );
  });

  it("renders object array items as indented key/value lines", () => {
    expect(
      renderTemplate("{{steps}}", {
        steps: [
          { id: "s1", done: false },
          { id: "s2", meta: { x: 1 }, note: null },
        ],
      }),
    ).toBe("  - id: s1\n  - done: false\n  - id: s2\n  - meta: {\"x\":1}\n  - note: ");
  });

  it("renders an empty array as an empty string", () => {
    expect(renderTemplate("[{{xs}}]", { xs: [] })).toBe("[]");
  });
});

describe("loadPromptTemplate", () => {
  it("loads a bundled prompt template from the prompts directory", () => {
    const tpl = loadPromptTemplate("planner.user.md");
    expect(tpl).toContain("{{previousPlanSection}}");
  });

  it("throws ENOENT for a template that does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow(/ENOENT/);
  });
});
