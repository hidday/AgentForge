// Supplementary DistilledSkillPanel coverage: loading/error states and the
// name/category/description fallback chain.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";
import type { DistillationDecision, SkillDocument } from "@/api/client.ts";

function decision(overrides: Partial<DistillationDecision> = {}): DistillationDecision {
  return {
    shouldPersist: true,
    reason: "",
    taskCategory: null,
    name: null,
    description: null,
    displacedSkillId: null,
    ...overrides,
  };
}

function skill(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    id: "s1",
    repoSlug: "org/repo",
    name: null,
    description: null,
    taskCategory: "bugfix",
    skillMarkdown: "# Body",
    utilityScore: 1,
    lastUsedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("DistilledSkillPanel states", () => {
  it("shows a loading indicator, taking precedence over error and data", () => {
    render(
      <DistilledSkillPanel distilledSkill={skill()} distillationDecision={decision()} loading error="x" />,
    );
    expect(screen.getByText("Loading distilled skill...")).toBeTruthy();
    expect(screen.queryByText("x")).toBeNull();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("shows the error when not loading", () => {
    render(<DistilledSkillPanel distilledSkill={null} distillationDecision={decision()} error="Skills API down" />);
    expect(screen.getByText("Skills API down").className).toContain("text-state-blocked");
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("renders nothing without a decision or when not persisted", () => {
    const { container, rerender } = render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={null} />,
    );
    expect(container.innerHTML).toBe("");
    rerender(<DistilledSkillPanel distilledSkill={skill()} distillationDecision={decision({ shouldPersist: false })} />);
    expect(container.innerHTML).toBe("");
  });

  it("falls back to the skill's task category for the name and hides export preview without a description", () => {
    render(<DistilledSkillPanel distilledSkill={skill()} distillationDecision={decision()} />);
    // name falls back to taskCategory, which is also shown as the category line
    expect(screen.getAllByText("bugfix")).toHaveLength(2);
    expect(screen.queryByText("SKILL.md export preview")).toBeNull();
    expect(screen.queryByText(/Displaced skill/)).toBeNull();
    expect(screen.getByText("Body").tagName).toBe("H1");
  });

  it("falls back to the decision's category, then to 'distilled-skill'", () => {
    const { rerender } = render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={decision({ taskCategory: "refactor" })} />,
    );
    expect(screen.getAllByText("refactor")).toHaveLength(2);
    expect(screen.getByText(/its content could not be loaded/)).toBeTruthy();

    rerender(<DistilledSkillPanel distilledSkill={null} distillationDecision={decision()} />);
    expect(screen.getByText("distilled-skill")).toBeTruthy();
  });

  it("prefers decision name/description when the skill lacks them and shows the export preview", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={skill({ skillMarkdown: "steps" })}
        distillationDecision={decision({
          name: "decision-name",
          description: "decision desc",
          displacedSkillId: "0123456789abcdef",
        })}
      />,
    );
    expect(screen.getByText("decision-name")).toBeTruthy();
    expect(screen.getByText("decision desc")).toBeTruthy();
    const pre = screen.getByText(/^---/);
    expect(pre.textContent).toBe("---\nname: decision-name\ndescription: >-\n  decision desc\n---\n\nsteps");
    expect(screen.getByText("Displaced skill: 01234567")).toBeTruthy();
  });
});
