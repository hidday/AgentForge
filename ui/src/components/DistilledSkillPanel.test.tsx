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

  it("renders a loading spinner and skips the decision entirely while loading", () => {
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

  it("renders the error message and skips the decision entirely when error is set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={decision}
        error="Failed to load distillation decision"
      />,
    );

    expect(screen.getByText("Failed to load distillation decision")).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("prioritizes the loading state over the error state when both are set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading
        error="Boom"
      />,
    );

    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
    expect(screen.queryByText("Boom")).toBeNull();
  });

  it("falls back to taskCategory for the skill name when name is unset on both sources", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: "fallback-category" }}
      />,
    );

    // taskCategory is used both as the fallback name and as the secondary
    // label, so it legitimately appears twice.
    expect(screen.getAllByText("fallback-category").length).toBe(2);
  });

  it("falls back to the default name when neither name nor taskCategory is set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: null }}
      />,
    );

    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("renders the displaced skill id when present", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "old-skill-id-1234" }}
      />,
    );

    expect(screen.getByText(/Displaced skill: old-skil/)).toBeDefined();
  });

  it("omits the displaced skill row when displacedSkillId is null", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={decision}
      />,
    );

    expect(screen.queryByText(/Displaced skill:/)).toBeNull();
  });

  it("omits the export preview block when skillDescription is unavailable", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, description: null }}
        distillationDecision={{ ...decision, description: null }}
      />,
    );

    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
  });
});
