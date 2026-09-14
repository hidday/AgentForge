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

  it("shows a loading indicator when loading is true, before checking decision/skill", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );
    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
  });

  it("shows an error message when error is set, taking priority over loading/decision", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to fetch skills"
      />,
    );
    expect(screen.getByText("Failed to fetch skills")).toBeDefined();
    expect(screen.queryByText(/Loading distilled skill/i)).toBeNull();
  });

  it("renders nothing when distillationDecision is null and not loading/erroring", () => {
    const { container } = render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("falls back to the decision's taskCategory for the skill name when no skill/name is available", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          ...decision,
          name: null,
          description: null,
          taskCategory: "cat-x",
        }}
      />,
    );
    // "cat-x" is used both as the derived skill name and (separately) as the
    // taskCategory subtitle, so it appears twice.
    expect(screen.getAllByText("cat-x").length).toBeGreaterThanOrEqual(1);
    // No description available from either source -> no description paragraph
    // and no SKILL.md export preview section.
    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
  });

  it("falls all the way back to the literal 'distilled-skill' name when nothing else is available", () => {
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

  it("falls back to the persisted skill's own taskCategory for the name", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={{ ...skill, name: null, taskCategory: "from-skill-cat" }}
        distillationDecision={{ ...decision, name: null, taskCategory: null }}
      />,
    );
    expect(screen.getAllByText("from-skill-cat").length).toBeGreaterThanOrEqual(1);
  });

  it("renders a truncated displaced-skill id when one is present", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "displaced-skill-id-1234" }}
      />,
    );
    expect(screen.getByText(/Displaced skill: displace/)).toBeDefined();
  });
});
