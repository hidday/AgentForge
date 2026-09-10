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

  it("shows a loading indicator", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading
      />,
    );
    expect(screen.getByText(/Loading distilled skill/)).toBeDefined();
  });

  it("shows an error message", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to fetch skills"
      />,
    );
    expect(screen.getByText("Failed to fetch skills")).toBeDefined();
  });

  it("falls back through the skill name chain to the decision's task category", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: "fallback-category" }}
      />,
    );
    expect(screen.getAllByText("fallback-category").length).toBeGreaterThan(0);
  });

  it("falls back to a default name when no name or category is available", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, name: null, taskCategory: null }}
      />,
    );
    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("shows no description or export preview when neither skill nor decision has one", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...decision, description: null }}
      />,
    );
    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
  });

  it("shows the displaced skill id when a skill was displaced", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...decision, displacedSkillId: "displaced-skill-12345678" }}
      />,
    );
    expect(screen.getByText((_, el) => el?.textContent === "Displaced skill: displace")).toBeDefined();
  });
});
