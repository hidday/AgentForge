import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { loadPromptTemplate, renderTemplate } from "../../src/agents/promptRenderer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, "../../src/prompts");

describe("loadPromptTemplate()", () => {
  it("reads a real prompt template file's contents from src/prompts", () => {
    const contents = loadPromptTemplate("_execution-score-rubric.md");
    const expected = readFileSync(resolve(PROMPTS_DIR, "_execution-score-rubric.md"), "utf-8");
    expect(contents).toBe(expected);
    expect(contents.length).toBeGreaterThan(0);
  });

  it("throws when the requested template file does not exist", () => {
    expect(() => loadPromptTemplate("does-not-exist.md")).toThrow();
  });
});

describe("renderTemplate()", () => {
  it("substitutes a simple top-level string variable", () => {
    const result = renderTemplate("Hello {{name}}!", { name: "World" });
    expect(result).toBe("Hello World!");
  });

  it("formats number and boolean values as their string representation", () => {
    const result = renderTemplate("count={{count}} active={{active}}", {
      count: 42,
      active: true,
    });
    expect(result).toBe("count=42 active=true");
  });

  it("renders an empty string for null or undefined leaf values", () => {
    const result = renderTemplate("value=[{{missing}}] nully=[{{nully}}]", {
      missing: undefined,
      nully: null,
    });
    expect(result).toBe("value=[] nully=[]");
  });

  it("resolves nested dotted paths through plain objects", () => {
    const result = renderTemplate("{{repo.name}} on {{repo.branch}}", {
      repo: { name: "AgentForge", branch: "main" },
    });
    expect(result).toBe("AgentForge on main");
  });

  it("leaves the placeholder unchanged when an intermediate path segment is missing", () => {
    const result = renderTemplate("{{repo.owner.login}}", { repo: {} });
    expect(result).toBe("{{repo.owner.login}}");
  });

  it("leaves the placeholder unchanged when an intermediate path segment is a primitive, not an object", () => {
    const result = renderTemplate("{{issue.title.length}}", { issue: { title: "hi" } });
    expect(result).toBe("{{issue.title.length}}");
  });

  it("renders a plain (non-array) object leaf value as JSON", () => {
    const result = renderTemplate("meta={{meta}}", { meta: { a: 1, b: "x" } });
    expect(result).toBe(`meta=${JSON.stringify({ a: 1, b: "x" })}`);
  });

  it("renders an array of primitive values as a numbered list", () => {
    const result = renderTemplate("{{items}}", { items: ["one", "two", "three"] });
    expect(result).toBe("1. one\n2. two\n3. three");
  });

  it("renders an array of objects as bulleted key/value entries per item", () => {
    const result = renderTemplate("{{steps}}", {
      steps: [
        { id: "s1", title: "First" },
        { id: "s2", title: "Second" },
      ],
    });
    expect(result).toBe("  - id: s1\n  - title: First\n  - id: s2\n  - title: Second");
  });

  it("renders an empty array as an empty string", () => {
    const result = renderTemplate("before[{{items}}]after", { items: [] });
    expect(result).toBe("before[]after");
  });

  it("returns the template unchanged when it has no placeholders", () => {
    const result = renderTemplate("Nothing to see here.", { unused: "value" });
    expect(result).toBe("Nothing to see here.");
  });

  it("substitutes multiple distinct placeholders in a single template", () => {
    const result = renderTemplate("{{a}}-{{b}}-{{a}}", { a: "x", b: "y" });
    expect(result).toBe("x-y-x");
  });
});
