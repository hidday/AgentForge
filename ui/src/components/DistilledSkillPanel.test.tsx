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

  it("renders a loading indicator and nothing else when loading is true", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading
      />,
    );

    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("falls back to the decision's taskCategory as the skill name when neither skill nor decision has a name", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: "fallback-category" }}
      />,
    );

    expect(screen.getAllByText("fallback-category").length).toBeGreaterThan(0);
  });

  it("falls back to the literal 'distilled-skill' name when no name or taskCategory is available anywhere", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: null }}
      />,
    );

    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("renders no description paragraph when neither skill nor decision has a description", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, description: null }}
      />,
    );

    expect(screen.getByText(/content could not be loaded/i)).toBeDefined();
    // The decision's own description text must not appear anywhere —
    // skillDescription resolved to null, not the decision's description.
    expect(
      screen.queryByText(/Use when changing prysmic dev-env pause\/resume/i),
    ).toBeNull();
  });

  it("shows the displaced skill id when the decision displaced an existing skill", () => {
    const { container } = render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "old-skill-id-123" }}
      />,
    );

    expect(container.textContent).toContain("Displaced skill: old-skil");
  });

  it("renders the error message and nothing else when error is set, even with a decision present", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={decision}
        error="Failed to load distilled skill"
      />,
    );

    expect(screen.getByText("Failed to load distilled skill")).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });
});
