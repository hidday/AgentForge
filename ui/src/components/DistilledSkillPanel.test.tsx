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

  it("falls back to distillationDecision.description when distilledSkill has none", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, description: null }}
        distillationDecision={decision}
      />,
    );
    expect(
      screen.getByText(
        "Use when changing prysmic dev-env pause/resume, deploy-while-paused behavior, or terraform_runner.",
      ),
    ).toBeDefined();
  });

  it("falls back through the name chain to distillationDecision.name when distilledSkill is null", () => {
    render(<DistilledSkillPanel distilledSkill={null} distillationDecision={decision} />);
    expect(screen.getByText("dev-env-pause-resume-footguns")).toBeDefined();
  });

  it("falls back to distillationDecision.taskCategory when no name is available anywhere", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null }}
      />,
    );
    expect(screen.getAllByText("dev-env pause/resume tooling").length).toBeGreaterThan(0);
  });

  it("falls back to the literal 'distilled-skill' when no name or category is available", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: null }}
      />,
    );
    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("shows the displaced skill id when a skill was displaced", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "old-skill-id-123" }}
      />,
    );
    const displacedLine = screen.getByText(/Displaced skill:/);
    expect(displacedLine.textContent).toBe("Displaced skill: old-skil");
  });

  it("shows a loading indicator when loading is true", () => {
    render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={null} loading />,
    );
    expect(screen.getByText("Loading distilled skill...")).toBeDefined();
  });

  it("shows an error message when error is set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="failed to load skills"
      />,
    );
    expect(screen.getByText("failed to load skills")).toBeDefined();
  });
});
