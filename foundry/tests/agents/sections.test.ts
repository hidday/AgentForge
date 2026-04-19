import { describe, it, expect } from "vitest";
import {
  renderRelatedContextSection,
  RELATED_CONTEXT_BEGIN_FENCE,
  RELATED_CONTEXT_END_FENCE,
} from "../../src/agents/sections.js";
import type { RelatedContext, RelatedIssue } from "../../src/schemas/taskBundle.js";

function makeRelatedIssue(overrides: Partial<RelatedIssue> = {}): RelatedIssue {
  return {
    id: "issue-uuid-1",
    identifier: "PRY-100",
    title: "Parent: Build feature X",
    description: "Roll-up issue tracking the broader feature X effort.",
    state: "In Progress",
    labels: ["epic"],
    priority: 2,
    url: "https://linear.app/team/issue/PRY-100",
    ...overrides,
  };
}

describe("renderRelatedContextSection", () => {
  it("returns an empty string when relatedContext is undefined", () => {
    expect(renderRelatedContextSection(undefined)).toBe("");
  });

  it("returns an empty string when relatedContext has no parent and no blockers", () => {
    const ctx: RelatedContext = { blockers: [] };
    expect(renderRelatedContextSection(ctx)).toBe("");
  });

  it("renders only the Parent Issue subsection when there is a parent and no blockers", () => {
    const out = renderRelatedContextSection({ parent: makeRelatedIssue(), blockers: [] });

    expect(out).toContain(RELATED_CONTEXT_BEGIN_FENCE);
    expect(out).toContain(RELATED_CONTEXT_END_FENCE);
    expect(out).toContain("## Background: Related Linear Context (NOT the focus issue)");
    expect(out).toContain("STRICTLY ADDITIONAL BACKGROUND");
    expect(out).toContain("### Background: Parent Issue");
    expect(out).toContain("- **Identifier**: PRY-100");
    expect(out).toContain("- **ID**: issue-uuid-1");
    expect(out).toContain("- **Title**: Parent: Build feature X");
    expect(out).toContain("- **State**: In Progress");
    expect(out).toContain("- **Labels**: epic");
    expect(out).toContain("- **Priority**: 2");
    expect(out).toContain("- **URL**: https://linear.app/team/issue/PRY-100");
    expect(out).toContain("**Description**:");
    expect(out).toContain("Roll-up issue tracking the broader feature X effort.");
    expect(out).not.toContain("### Background: Blocker Issues");
  });

  it("renders only the Blocker Issues subsection when there are blockers but no parent", () => {
    const blocker = makeRelatedIssue({
      id: "blocker-uuid-1",
      identifier: "PRY-101",
      title: "Blocker: ship migration",
      description: "Migration must complete before this issue can ship.",
      state: "Todo",
      labels: ["infra"],
      priority: 1,
    });

    const out = renderRelatedContextSection({ blockers: [blocker] });

    expect(out).toContain(RELATED_CONTEXT_BEGIN_FENCE);
    expect(out).toContain(RELATED_CONTEXT_END_FENCE);
    expect(out).toContain("## Background: Related Linear Context (NOT the focus issue)");
    expect(out).not.toContain("### Background: Parent Issue");
    expect(out).toContain(
      "### Background: Blocker Issues (must be understood before the focus issue can ship)",
    );
    expect(out).toContain("#### Background: Blocker 1");
    expect(out).toContain("- **Identifier**: PRY-101");
    expect(out).toContain("- **Title**: Blocker: ship migration");
    expect(out).toContain("Migration must complete before this issue can ship.");
  });

  it("renders both parent and blockers, numbering blockers in order", () => {
    const parent = makeRelatedIssue({ identifier: "PRY-100" });
    const blocker1 = makeRelatedIssue({
      id: "b1",
      identifier: "PRY-101",
      title: "First blocker",
    });
    const blocker2 = makeRelatedIssue({
      id: "b2",
      identifier: "PRY-102",
      title: "Second blocker",
    });

    const out = renderRelatedContextSection({ parent, blockers: [blocker1, blocker2] });

    expect(out).toContain("### Background: Parent Issue");
    expect(out).toContain("PRY-100");
    expect(out).toContain("#### Background: Blocker 1");
    expect(out).toContain("PRY-101");
    expect(out).toContain("First blocker");
    expect(out).toContain("#### Background: Blocker 2");
    expect(out).toContain("PRY-102");
    expect(out).toContain("Second blocker");

    const idx100 = out.indexOf("PRY-100");
    const idx101 = out.indexOf("PRY-101");
    const idx102 = out.indexOf("PRY-102");
    expect(idx100).toBeLessThan(idx101);
    expect(idx101).toBeLessThan(idx102);
  });

  it("wraps the rendered block with explicit BEGIN and END fences in the correct order", () => {
    const out = renderRelatedContextSection({
      parent: makeRelatedIssue(),
      blockers: [makeRelatedIssue({ id: "b", identifier: "PRY-201", title: "blocker" })],
    });

    const beginIdx = out.indexOf(RELATED_CONTEXT_BEGIN_FENCE);
    const endIdx = out.indexOf(RELATED_CONTEXT_END_FENCE);
    const parentIdx = out.indexOf("### Background: Parent Issue");
    const blockerIdx = out.indexOf("#### Background: Blocker 1");

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(beginIdx);
    expect(parentIdx).toBeGreaterThan(beginIdx);
    expect(parentIdx).toBeLessThan(endIdx);
    expect(blockerIdx).toBeGreaterThan(parentIdx);
    expect(blockerIdx).toBeLessThan(endIdx);
  });

  it("falls back to placeholders for missing identifier, URL, labels, and description", () => {
    const sparse = makeRelatedIssue({
      identifier: undefined,
      url: undefined,
      labels: [],
      description: "",
    });

    const out = renderRelatedContextSection({ parent: sparse, blockers: [] });

    expect(out).toContain("- **Identifier**: (unknown)");
    expect(out).toContain("- **URL**: (no URL)");
    expect(out).toContain("- **Labels**: (none)");
    expect(out).toContain("(no description)");
  });
});
