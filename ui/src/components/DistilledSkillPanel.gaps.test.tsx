import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";
import type { DistillationDecision } from "@/api/client.ts";

// Covers the loading and error early-return branches, the skillName /
// skillDescription fallback chains, and the displacedSkillId branch that
// DistilledSkillPanel.test.tsx does not exercise.
describe("DistilledSkillPanel gaps", () => {
  it("renders a loading indicator when loading is true", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );

    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
    // The error/empty/content branches must not also render.
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("renders the error message when error is set, taking priority over loading", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to load distilled skill"
      />,
    );

    expect(screen.getByText("Failed to load distilled skill")).toBeDefined();
    expect(screen.queryByText(/Loading distilled skill/i)).toBeNull();
  });

  it("falls back to distillationDecision.taskCategory for the name when distilledSkill is absent", () => {
    const decision: DistillationDecision = {
      shouldPersist: true,
      reason: "reason",
      taskCategory: "fallback-category",
      name: null,
      description: null,
      displacedSkillId: null,
    };

    render(<DistilledSkillPanel distilledSkill={null} distillationDecision={decision} />);

    // Both the name slot and the task-category slot resolve to the same
    // fallback value here, so two elements render it.
    const matches = screen.getAllByText("fallback-category");
    expect(matches.length).toBe(2);
  });

  it("falls all the way back to the literal 'distilled-skill' name when nothing else is available", () => {
    const decision: DistillationDecision = {
      shouldPersist: true,
      reason: "reason",
      taskCategory: null,
      name: null,
      description: null,
      displacedSkillId: null,
    };

    render(<DistilledSkillPanel distilledSkill={null} distillationDecision={decision} />);

    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("renders no description when neither distilledSkill nor the decision provides one", () => {
    const decision: DistillationDecision = {
      shouldPersist: true,
      reason: "reason",
      taskCategory: "cat",
      name: "name",
      description: null,
      displacedSkillId: null,
    };

    render(<DistilledSkillPanel distilledSkill={null} distillationDecision={decision} />);

    // The fallback "content could not be loaded" message still renders
    // (distilledSkill is null), but no description paragraph is present.
    expect(screen.getByText(/content could not be loaded/i)).toBeDefined();
  });

  it("renders the displaced skill id when present", () => {
    const decision: DistillationDecision = {
      shouldPersist: true,
      reason: "reason",
      taskCategory: "cat",
      name: "name",
      description: null,
      displacedSkillId: "displaced-uuid-1234",
    };

    render(<DistilledSkillPanel distilledSkill={null} distillationDecision={decision} />);

    // Rendered as "Displaced skill: " + the id truncated to 8 chars.
    expect(
      screen.getByText(
        (_, el) => el?.textContent === "Displaced skill: displace",
      ),
    ).toBeDefined();
  });
});
