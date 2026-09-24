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

  it("shows a loading indicator when loading is true, before considering distillationDecision", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );

    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("shows an error message when error is set, taking precedence over the loading/decision state", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={decision}
        error="Failed to load distilled skill"
      />,
    );

    expect(screen.getByText("Failed to load distilled skill")).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("shows the displaced skill id, truncated to 8 characters, when present", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{
          ...decision,
          displacedSkillId: "displaced-skill-uuid-1234",
        }}
      />,
    );

    const el = screen.getByText(/Displaced skill:/);
    expect(el.textContent).toContain("displace");
    expect(el.textContent).not.toContain("displaced-skill-uuid-1234");
  });

  it("does not show a displaced skill line when displacedSkillId is null", () => {
    render(
      <DistilledSkillPanel distilledSkill={skill} distillationDecision={decision} />,
    );

    expect(screen.queryByText(/Displaced skill:/)).toBeNull();
  });

  it("falls all the way through the name/description fallback chain to 'distilled-skill' and no description", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          shouldPersist: true,
          reason: "reason",
          taskCategory: null,
          name: null,
          description: null,
          displacedSkillId: null,
        }}
      />,
    );

    // distilledSkill?.name, distillationDecision.name,
    // distilledSkill?.taskCategory, and distillationDecision.taskCategory are
    // all unavailable, so the header falls back to the final literal.
    expect(screen.getByText("distilled-skill")).toBeDefined();
    // skillDescription is also null all the way through its chain, so no
    // description paragraph and no export preview should render.
    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
  });
});
