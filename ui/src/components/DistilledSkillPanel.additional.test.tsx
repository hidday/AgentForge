import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
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

describe("DistilledSkillPanel — additional coverage", () => {
  it("renders a loading spinner and message when loading is true", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );

    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
    // Neither the error nor the persisted-skill UI should render.
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("renders an error message and suppresses everything else when error is set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={decision}
        error="Failed to load distilled skill"
      />,
    );

    expect(screen.getByText("Failed to load distilled skill")).toBeDefined();
    // Even though distilledSkill/distillationDecision would normally render
    // full content, the error branch takes precedence and returns early.
    expect(screen.queryByText("Distilled Skill")).toBeNull();
    expect(screen.queryByText(/Loading distilled skill/i)).toBeNull();
  });

  it("loading takes precedence over error when both are set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
        error="should not show"
      />,
    );

    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("falls back to distilledSkill.taskCategory for the name when both name fields are null", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, name: null, taskCategory: "category-from-skill" }}
        distillationDecision={{ ...decision, name: null }}
      />,
    );

    // Both the skill-name line and the taskCategory line below it render the
    // same fallback string here, since distilledSkill.taskCategory feeds both.
    expect(screen.getAllByText("category-from-skill").length).toBeGreaterThan(0);
  });

  it("falls back to distillationDecision.taskCategory for the name when distilledSkill is null and both name fields are null", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          ...decision,
          name: null,
          taskCategory: "category-from-decision",
        }}
      />,
    );

    // The header's mono skill-name line should show the fallback category.
    const monoNames = screen.getAllByText("category-from-decision");
    expect(monoNames.length).toBeGreaterThan(0);
  });

  it('falls back to the literal "distilled-skill" name when every name/category source is null', () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: null }}
      />,
    );

    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("renders without a description paragraph or export preview when no description is available anywhere", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, description: null }}
        distillationDecision={{ ...decision, description: null }}
      />,
    );

    // The skill markdown itself still renders...
    expect(screen.getByTestId("markdown-content")).toBeDefined();
    // ...but the description paragraph and the SKILL.md export preview
    // (which both require a non-null skillDescription) are absent.
    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
  });

  it("renders the displaced skill id (truncated to 8 chars) when one was displaced", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{
          ...decision,
          displacedSkillId: "abcdef1234567890",
        }}
      />,
    );

    expect(screen.getByText(/Displaced skill:/)).toBeDefined();
    expect(screen.getByText(/abcdef12$/)).toBeDefined();
  });
});
