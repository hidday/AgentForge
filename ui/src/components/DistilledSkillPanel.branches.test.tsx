import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";
import type { DistillationDecision, SkillDocument } from "@/api/client.ts";

const decision: DistillationDecision = {
  shouldPersist: true,
  reason: "Non-trivial repo-specific insight.",
  taskCategory: "dev-env pause/resume tooling",
  name: "dev-env-pause-resume-footguns",
  description: "A useful skill description.",
  displacedSkillId: null,
};

const skill: SkillDocument = {
  id: "skill-1",
  repoSlug: "prysmic-ai/prysmic",
  name: "dev-env-pause-resume-footguns",
  description: "A useful skill description.",
  taskCategory: "dev-env pause/resume tooling",
  skillMarkdown: "# Pause/resume footguns",
  utilityScore: 0,
  lastUsedAt: "2026-06-08T16:26:58.000Z",
};

describe("DistilledSkillPanel branch coverage", () => {
  it("renders the loading state and nothing else", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading
      />,
    );
    expect(screen.getByText(/loading distilled skill/i)).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("renders the error state instead of the panel content", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to load skill"
      />,
    );
    expect(screen.getByText("Failed to load skill")).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("the loading state takes precedence over the error state when both are set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading
        error="Boom"
      />,
    );
    expect(screen.getByText(/loading distilled skill/i)).toBeDefined();
    expect(screen.queryByText("Boom")).toBeNull();
  });

  it("returns null when distillationDecision is null (not just shouldPersist: false)", () => {
    const { container } = render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("falls back to distillationDecision.name when distilledSkill is null", () => {
    render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={decision} />,
    );
    expect(screen.getByText(decision.name!)).toBeDefined();
  });

  it("falls back to distilledSkill.taskCategory when both names are missing", () => {
    const skillNoName: SkillDocument = { ...skill, name: null };
    const decisionNoName: DistillationDecision = { ...decision, name: null };
    render(
      <DistilledSkillPanel
        distilledSkill={skillNoName}
        distillationDecision={decisionNoName}
      />,
    );
    // Both the header name and the task-category line render the same
    // fallback string, since skillName === taskCategory in this case.
    expect(screen.getAllByText(skill.taskCategory).length).toBeGreaterThan(0);
  });

  it("falls back to the literal 'distilled-skill' when every name source is missing", () => {
    const skillNoName: SkillDocument = {
      ...skill,
      name: null,
      taskCategory: undefined as unknown as string,
    };
    const decisionNoName: DistillationDecision = {
      ...decision,
      name: null,
      taskCategory: null,
    };
    render(
      <DistilledSkillPanel
        distilledSkill={skillNoName}
        distillationDecision={decisionNoName}
      />,
    );
    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("does not render a task-category line when neither source provides one", () => {
    const skillNoCategory: SkillDocument = { ...skill, taskCategory: "" };
    const decisionNoCategory: DistillationDecision = {
      ...decision,
      taskCategory: null,
    };
    render(
      <DistilledSkillPanel
        distilledSkill={skillNoCategory}
        distillationDecision={decisionNoCategory}
      />,
    );
    expect(screen.queryByText(skill.taskCategory)).toBeNull();
  });

  it("does not render the reason block when the decision has no reason", () => {
    const decisionNoReason: DistillationDecision = { ...decision, reason: "" };
    render(
      <DistilledSkillPanel distilledSkill={skill} distillationDecision={decisionNoReason} />,
    );
    expect(screen.queryByText(decision.reason)).toBeNull();
  });

  it("falls back to distillationDecision.description when distilledSkill has none", () => {
    const skillNoDescription: SkillDocument = { ...skill, description: null };
    render(
      <DistilledSkillPanel
        distilledSkill={skillNoDescription}
        distillationDecision={decision}
      />,
    );
    expect(screen.getAllByText(decision.description!).length).toBeGreaterThan(0);
  });

  it("does not render the SKILL.md export preview when there is no description", () => {
    const skillNoDescription: SkillDocument = { ...skill, description: null };
    const decisionNoDescription: DistillationDecision = {
      ...decision,
      description: null,
    };
    render(
      <DistilledSkillPanel
        distilledSkill={skillNoDescription}
        distillationDecision={decisionNoDescription}
      />,
    );
    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
  });

  it("renders the displaced skill id (truncated) when one is provided", () => {
    const decisionWithDisplaced: DistillationDecision = {
      ...decision,
      displacedSkillId: "old-skill-id-1234",
    };
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={decisionWithDisplaced}
      />,
    );
    const row = screen.getByText(/Displaced skill:/);
    expect(row.textContent).toBe("Displaced skill: old-skil");
  });

  it("does not render the displaced skill line when displacedSkillId is null", () => {
    render(<DistilledSkillPanel distilledSkill={skill} distillationDecision={decision} />);
    expect(screen.queryByText(/Displaced skill:/)).toBeNull();
  });
});
