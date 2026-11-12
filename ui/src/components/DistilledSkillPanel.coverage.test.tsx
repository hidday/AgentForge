import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";
import type { DistillationDecision, SkillDocument } from "@/api/client.ts";

// Closes coverage gaps in DistilledSkillPanel.tsx not exercised by
// DistilledSkillPanel.test.tsx: the loading state (line 27), the error
// state (line 38), every link of the skillName fallback chain, the
// skillDescription double-null fallback, and the displacedSkillId footer.
describe("DistilledSkillPanel – loading and error states", () => {
  it("shows a loading indicator when loading is true", () => {
    render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={null} loading={true} />,
    );

    expect(screen.getByText(/loading distilled skill/i)).toBeDefined();
  });

  it("shows the error message when error is set, even if a decision is also present", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          shouldPersist: true,
          reason: "ok",
          taskCategory: null,
          name: null,
          description: null,
          displacedSkillId: null,
        }}
        error="Failed to load skill"
      />,
    );

    expect(screen.getByText("Failed to load skill")).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("prioritizes the loading state over the error state", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
        error="Should not be shown"
      />,
    );

    expect(screen.getByText(/loading distilled skill/i)).toBeDefined();
    expect(screen.queryByText("Should not be shown")).toBeNull();
  });

  const baseDecision: DistillationDecision = {
    shouldPersist: true,
    reason: "",
    taskCategory: null,
    name: null,
    description: null,
    displacedSkillId: null,
  };

  const baseSkill: SkillDocument = {
    id: "skill-1",
    repoSlug: "acme/repo",
    name: null,
    description: null,
    taskCategory: "fallback-category",
    skillMarkdown: "# Some skill",
    utilityScore: 0,
    lastUsedAt: "2026-01-01T00:00:00Z",
  };

  it("falls back to distilledSkill.taskCategory when both names are absent", () => {
    const { container } = render(
      <DistilledSkillPanel
        distilledSkill={{ ...baseSkill, taskCategory: "skill-task-category" }}
        distillationDecision={{ ...baseDecision, taskCategory: "decision-task-category" }}
      />,
    );

    // distilledSkill.taskCategory takes priority over the decision's for the
    // skill-name slot specifically (the secondary taskCategory line below it
    // uses the same two-term chain and legitimately repeats the value).
    const nameEl = container.querySelector("p.font-mono.text-xs.text-accent.truncate");
    expect(nameEl?.textContent).toBe("skill-task-category");
  });

  it("falls back to distillationDecision.taskCategory when both names and the skill's taskCategory are absent", () => {
    const { container } = render(
      <DistilledSkillPanel
        // taskCategory is typed as a required string, but real API payloads
        // aren't always well-formed — simulate a missing value as the
        // component's defensive `??` chain is written to handle.
        distilledSkill={{ ...baseSkill, taskCategory: null as unknown as string }}
        distillationDecision={{ ...baseDecision, taskCategory: "decision-task-category" }}
      />,
    );

    const nameEl = container.querySelector("p.font-mono.text-xs.text-accent.truncate");
    expect(nameEl?.textContent).toBe("decision-task-category");
  });

  it("falls back to the literal 'distilled-skill' name when every source is absent", () => {
    const { container } = render(
      <DistilledSkillPanel
        distilledSkill={{ ...baseSkill, taskCategory: null as unknown as string }}
        distillationDecision={{ ...baseDecision, taskCategory: null }}
      />,
    );

    const nameEl = container.querySelector("p.font-mono.text-xs.text-accent.truncate");
    expect(nameEl?.textContent).toBe("distilled-skill");
    // With taskCategory absent on both sides, the secondary taskCategory
    // line isn't rendered at all.
    expect(screen.queryByText("decision-task-category")).toBeNull();
  });

  it("renders with no description paragraph when both description sources are null", () => {
    const { container } = render(
      <DistilledSkillPanel
        distilledSkill={{ ...baseSkill, description: null }}
        distillationDecision={{ ...baseDecision, description: null }}
      />,
    );

    // No description text node, and no SKILL.md export preview (which
    // requires a non-null skillDescription).
    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
    expect(container.querySelector("p.text-xs.text-text-secondary")).toBeNull();
  });

  it("shows the displaced-skill footer when displacedSkillId is set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={baseSkill}
        distillationDecision={{ ...baseDecision, displacedSkillId: "old-skill-id-123" }}
      />,
    );

    expect(screen.getByText(/Displaced skill:/i).textContent).toContain("old-skil");
  });
});
