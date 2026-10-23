import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";
import type { DistillationDecision, SkillDocument } from "@/api/client.ts";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

const baseDecision: DistillationDecision = {
  shouldPersist: true,
  reason: "",
  taskCategory: null,
  name: null,
  description: null,
  displacedSkillId: null,
};

describe("DistilledSkillPanel gaps", () => {
  it("falls back to distilledSkill.taskCategory for the name when both name fields are null", () => {
    const skill: SkillDocument = {
      id: "s1",
      repoSlug: "org/repo",
      name: null,
      description: null,
      taskCategory: "deploy-tooling",
      skillMarkdown: "# content",
      utilityScore: 0,
      lastUsedAt: "2026-01-01T00:00:00Z",
    };
    render(<DistilledSkillPanel distilledSkill={skill} distillationDecision={baseDecision} />);
    // The taskCategory value is used both as the fallback name (mono accent
    // text) and as the subtitle beneath it, so both appear.
    const matches = screen.getAllByText("deploy-tooling");
    expect(matches.length).toBe(2);
    expect(matches.some((el) => el.className.includes("font-mono"))).toBe(true);
  });

  it("falls back to distillationDecision.taskCategory when distilledSkill is null and name fields are null", () => {
    const decision: DistillationDecision = {
      ...baseDecision,
      taskCategory: "ci-pipeline-insight",
    };
    render(<DistilledSkillPanel distilledSkill={null} distillationDecision={decision} />);
    const matches = screen.getAllByText("ci-pipeline-insight");
    expect(matches.length).toBe(2);
    expect(matches.some((el) => el.className.includes("font-mono"))).toBe(true);
  });

  it("falls back all the way to the 'distilled-skill' default name when nothing else is available", () => {
    render(<DistilledSkillPanel distilledSkill={null} distillationDecision={baseDecision} />);
    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("omits the description paragraph and the SKILL.md export preview when no description is available anywhere", () => {
    const skill: SkillDocument = {
      id: "s1",
      repoSlug: "org/repo",
      name: "my-skill",
      description: null,
      taskCategory: "general",
      skillMarkdown: "# content",
      utilityScore: 0,
      lastUsedAt: "2026-01-01T00:00:00Z",
    };
    render(<DistilledSkillPanel distilledSkill={skill} distillationDecision={baseDecision} />);
    expect(screen.queryByText(/SKILL.md export preview/i)).toBeNull();
  });

  it("renders a truncated displaced skill id when one is present", () => {
    const skill: SkillDocument = {
      id: "s1",
      repoSlug: "org/repo",
      name: "my-skill",
      description: "desc",
      taskCategory: "general",
      skillMarkdown: "# content",
      utilityScore: 0,
      lastUsedAt: "2026-01-01T00:00:00Z",
    };
    const decision: DistillationDecision = {
      ...baseDecision,
      displacedSkillId: "abcdefgh12345",
    };
    render(<DistilledSkillPanel distilledSkill={skill} distillationDecision={decision} />);
    expect(screen.getByText("Displaced skill: abcdefgh")).toBeDefined();
  });
});
