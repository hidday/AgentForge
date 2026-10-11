import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";
import type { DistillationDecision } from "@/api/client.ts";

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
  description: "Some description.",
  displacedSkillId: null,
};

describe("DistilledSkillPanel additional branches", () => {
  it("shows a loading spinner and message when loading is true", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );

    expect(screen.getByText("Loading distilled skill...")).toBeDefined();
  });

  it("shows the error message and styling when error is set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to fetch distilled skill"
      />,
    );

    const message = screen.getByText("Failed to fetch distilled skill");
    expect(message).toBeDefined();
    expect(message.className).toContain("text-state-blocked");
  });

  it("prefers loading over error when both are set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
        error="should not show"
      />,
    );

    expect(screen.getByText("Loading distilled skill...")).toBeDefined();
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("falls back to distillationDecision.taskCategory as the skill name when no other name is available", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          ...decision,
          name: null,
          taskCategory: "fallback-category",
        }}
      />,
    );

    expect(screen.getAllByText("fallback-category").length).toBeGreaterThan(0);
  });

  it("falls back to the generic 'distilled-skill' name when no name or category is available anywhere", () => {
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

  it("omits the description paragraph when no description is available anywhere", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          ...decision,
          description: null,
        }}
      />,
    );

    expect(screen.queryByText("Some description.")).toBeNull();
    // The reason and fallback content-missing message should still render.
    expect(screen.getByText("Non-trivial repo-specific insight.")).toBeDefined();
  });

  it("shows the displaced skill id truncated to 8 characters", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          ...decision,
          displacedSkillId: "abcdefghijklmnop",
        }}
      />,
    );

    expect(screen.getByText(/Displaced skill: abcdefgh/)).toBeDefined();
  });
});
