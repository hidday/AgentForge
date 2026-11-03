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
  it("shows a loading indicator when loading is true, regardless of other props", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );
    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
  });

  it("shows the error message and nothing else when error is set", () => {
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

  it("prioritizes the loading state over the error state", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
        error="some error"
      />,
    );
    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
    expect(screen.queryByText("some error")).toBeNull();
  });

  it("falls back to taskCategory for the skill name when name is absent on both objects", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, name: null }}
        distillationDecision={{ ...decision, name: null }}
      />,
    );
    expect(screen.getAllByText(skill.taskCategory).length).toBeGreaterThan(0);
  });

  it("falls back to the literal 'distilled-skill' name when nothing provides a name or category", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          ...decision,
          name: null,
          taskCategory: null,
        }}
      />,
    );
    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("does not render the SKILL.md export preview when skillDescription is missing", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, description: null }}
        distillationDecision={{ ...decision, description: null }}
      />,
    );
    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
  });

  it("shows the displaced skill id (truncated) when present", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "0123456789abcdef" }}
      />,
    );
    expect(screen.getByText(/Displaced skill: 01234567/)).toBeDefined();
  });

  it("does not show the displaced skill line when displacedSkillId is null", () => {
    render(<DistilledSkillPanel distilledSkill={skill} distillationDecision={decision} />);
    expect(screen.queryByText(/Displaced skill:/)).toBeNull();
  });

  it("does not render the reason block when reason is an empty string", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, reason: "" }}
      />,
    );
    expect(screen.queryByText(decision.reason)).toBeNull();
  });

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
});
