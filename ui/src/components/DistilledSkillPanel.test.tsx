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

  it("shows a loading indicator when loading is true, regardless of decision", () => {
    render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={null} loading={true} />,
    );
    expect(screen.getByText(/loading distilled skill/i)).toBeDefined();
  });

  it("shows an error message and skips the loading/skill UI when error is set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={decision}
        error="Failed to fetch skill"
      />,
    );
    expect(screen.getByText("Failed to fetch skill")).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
    expect(screen.queryByText(/loading distilled skill/i)).toBeNull();
  });

  it("falls back to the decision's taskCategory for the skill name when no name is available", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null }}
      />,
    );
    expect(screen.getAllByText("dev-env pause/resume tooling").length).toBeGreaterThan(0);
  });

  it("falls back to the literal 'distilled-skill' name when nothing names the skill", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: null }}
      />,
    );
    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("falls back to the decision's description when the distilled skill has none", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, description: null }}
        distillationDecision={decision}
      />,
    );
    expect(
      screen.getAllByText(/Use when changing prysmic dev-env pause\/resume/i).length,
    ).toBeGreaterThan(0);
  });

  it("omits the description block entirely when neither source has a description", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, description: null }}
        distillationDecision={{ ...decision, description: null }}
      />,
    );
    expect(screen.queryByText(/Use when changing prysmic/i)).toBeNull();
  });

  it("shows the displaced skill id when the distillation displaced an existing skill", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "skill-old-12345678" }}
      />,
    );
    expect(screen.getByText(/Displaced skill: skill-ol/)).toBeDefined();
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
