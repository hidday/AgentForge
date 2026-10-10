import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";
import type { DistillationDecision, SkillDocument } from "@/api/client.ts";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

const minimalDecision: DistillationDecision = {
  shouldPersist: true,
  reason: "",
  taskCategory: null,
  name: null,
  description: null,
  displacedSkillId: null,
};

describe("DistilledSkillPanel (gaps)", () => {
  it("shows the loading state", () => {
    render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={null} loading />,
    );
    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
  });

  it("shows the error state", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to fetch skills"
      />,
    );
    expect(screen.getByText("Failed to fetch skills")).toBeDefined();
  });

  it("falls all the way back to 'distilled-skill' when no name or taskCategory is available anywhere", () => {
    render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={minimalDecision} />,
    );
    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("falls back to distillationDecision.taskCategory for the name when distilledSkill is null and decision.name is null", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...minimalDecision, taskCategory: "auth refactors" }}
      />,
    );
    expect(screen.getAllByText("auth refactors").length).toBeGreaterThan(0);
  });

  it("falls back to distilledSkill.taskCategory for the name when both .name fields are null", () => {
    const skill: SkillDocument = {
      id: "s1",
      repoSlug: "org/repo",
      name: null,
      description: null,
      taskCategory: "db migrations",
      skillMarkdown: "# content",
      utilityScore: 0,
      lastUsedAt: "2026-01-01T00:00:00Z",
    };
    render(
      <DistilledSkillPanel
        distilledSkill={skill}
        distillationDecision={{ ...minimalDecision, taskCategory: null }}
      />,
    );
    // skillName resolves to skill.taskCategory ("db migrations"); the
    // taskCategory sub-line reuses the same value, so it appears twice.
    expect(screen.getAllByText("db migrations").length).toBeGreaterThan(0);
  });

  it("omits the description, export preview, and displaced-skill lines when none are present", () => {
    const skill: SkillDocument = {
      id: "s1",
      repoSlug: "org/repo",
      name: "my-skill",
      description: null,
      taskCategory: "",
      skillMarkdown: "# content",
      utilityScore: 0,
      lastUsedAt: "2026-01-01T00:00:00Z",
    };
    render(
      <DistilledSkillPanel distilledSkill={skill} distillationDecision={minimalDecision} />,
    );

    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
    expect(screen.queryByText(/Displaced skill:/i)).toBeNull();
  });

  it("renders the displaced-skill line (truncated id) when displacedSkillId is present", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{ ...minimalDecision, displacedSkillId: "abcdef1234567890" }}
      />,
    );
    expect(screen.getByText(/Displaced skill:/i).textContent).toContain("abcdef12");
  });

  it("does not render the italic reason line when reason is an empty string", () => {
    render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={minimalDecision} />,
    );
    // minimalDecision.reason is "" (falsy), so the reason paragraph is omitted.
    const italics = document.querySelectorAll("p.italic");
    expect(italics.length).toBe(0);
  });
});
