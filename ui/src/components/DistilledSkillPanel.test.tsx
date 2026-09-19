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
  it("shows a loading indicator when loading is true", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );

    expect(screen.getByText(/loading distilled skill/i)).toBeDefined();
  });

  it("shows the error message and takes precedence over the loading state when both are set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={false}
        error="Failed to load skill"
      />,
    );

    expect(screen.getByText("Failed to load skill")).toBeDefined();
    expect(screen.queryByText(/loading distilled skill/i)).toBeNull();
  });

  it("renders nothing when distillationDecision is null", () => {
    const { container } = render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={null} />,
    );

    expect(container.firstChild).toBeNull();
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

  it("falls back through the name chain to the decision's taskCategory when no name is set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: "fallback-category" }}
      />,
    );

    expect(screen.getAllByText("fallback-category").length).toBeGreaterThan(0);
  });

  it("falls back to the default 'distilled-skill' name when nothing else is available", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: null }}
      />,
    );

    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("uses the skill document's own name/description when the decision omits them", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, name: null, description: null }}
      />,
    );

    expect(screen.getByText(skill.name)).toBeDefined();
    expect(screen.getAllByText(skill.description).length).toBeGreaterThan(0);
  });

  it("renders no description or export preview when neither source provides one", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, description: null }}
        distillationDecision={{ ...decision, description: null }}
      />,
    );

    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
  });

  it("shows the displaced skill id when the decision reports one", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "old-skill-id-12345" }}
      />,
    );

    expect(
      screen.getByText((_, el) => el?.textContent === "Displaced skill: old-skil"),
    ).toBeDefined();
  });

  it("does not render a taskCategory line when neither source provides one", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, taskCategory: "" }}
        distillationDecision={{ ...decision, taskCategory: "" }}
      />,
    );

    // The heading/name still renders, but no separate taskCategory line.
    expect(screen.getByText("Distilled Skill")).toBeDefined();
  });
});
