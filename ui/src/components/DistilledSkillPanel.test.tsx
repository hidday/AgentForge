import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";
import type { DistillationDecision, SkillDocument } from "@/api/client.ts";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

const decision: DistillationDecision = {
  shouldPersist: true,
  reason: "Non-trivial repo-specific insight.",
  taskCategory: "dev-env pause/resume tooling",
  name: "dev-env-pause-resume-footguns",
  description:
    "Use when changing prysmic dev-env pause/resume, deploy-while-paused behavior, or terraform_runner.",
  displacedSkillId: null,
};

const skill: SkillDocument = {
  id: "skill-1",
  repoSlug: "prysmic-ai/prysmic",
  name: "dev-env-pause-resume-footguns",
  description:
    "Use when changing prysmic dev-env pause/resume, deploy-while-paused behavior, or terraform_runner.",
  taskCategory: "dev-env pause/resume tooling",
  skillMarkdown: "# Pause/resume footguns\n\nAlways pass `-var-file`.",
  utilityScore: 0,
  lastUsedAt: "2026-06-08T16:26:58.000Z",
};

describe("DistilledSkillPanel", () => {
  it("renders nothing when distillation did not persist a skill", () => {
    const { container } = render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          ...decision,
          shouldPersist: false,
          reason: "novelty_gate_failed",
        }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders the skill name, description, markdown, and export preview", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={decision}
      />,
    );

    expect(screen.getByText("Distilled Skill")).toBeDefined();
    expect(screen.getByText("dev-env-pause-resume-footguns")).toBeDefined();
    expect(screen.getAllByText(/Use when changing prysmic dev-env pause\/resume/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId("markdown-content").textContent).toContain(
      "# Pause/resume footguns",
    );
    expect(screen.getByText(/SKILL.md export preview/i)).toBeDefined();
    expect(screen.getByText(/name: dev-env-pause-resume-footguns/)).toBeDefined();
  });

  it("shows a fallback message when persistence succeeded but content is missing", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={decision}
      />,
    );

    expect(screen.getByText(/content could not be loaded/i)).toBeDefined();
  });

  it("renders a loading indicator when loading is true, before checking the decision", () => {
    const { container } = render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );
    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
    // The spinner element should be present too
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("falls back through the name chain to distillationDecision.name when distilledSkill has no name", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, name: null }}
        distillationDecision={decision}
      />,
    );
    expect(screen.getByText(decision.name!)).toBeDefined();
  });

  it("falls back to distilledSkill.taskCategory when both name fields are missing", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, name: null, taskCategory: "fallback-task-category" }}
        distillationDecision={{ ...decision, name: null }}
      />,
    );
    expect(screen.getAllByText("fallback-task-category").length).toBeGreaterThan(0);
  });

  it("falls back to distillationDecision.taskCategory when distilledSkill is null", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null }}
      />,
    );
    expect(screen.getAllByText(decision.taskCategory!).length).toBeGreaterThan(0);
  });

  it("falls back to the literal 'distilled-skill' name when every source is empty", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: null }}
      />,
    );
    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("falls back to distillationDecision.description when distilledSkill has no description", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, description: null }}
        distillationDecision={decision}
      />,
    );
    expect(screen.getAllByText(decision.description!).length).toBeGreaterThan(0);
  });

  it("renders no description paragraph when neither source provides one", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, description: null }}
        distillationDecision={{ ...decision, description: null }}
      />,
    );
    // The export preview section (which requires a description) should be absent
    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
  });

  it("renders the displaced skill id (truncated) when the decision reports one", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "0123456789abcdef" }}
      />,
    );
    expect(screen.getByText("Displaced skill: 01234567")).toBeDefined();
  });

  it("does not render a displaced-skill line when displacedSkillId is null", () => {
    render(<DistilledSkillPanel distilledSkill={skill} distillationDecision={decision} />);
    expect(screen.queryByText(/Displaced skill:/)).toBeNull();
  });

  it("renders an error message when error is set, taking priority over the decision", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to fetch skill"
      />,
    );
    expect(screen.getByText("Failed to fetch skill")).toBeDefined();
  });
});
