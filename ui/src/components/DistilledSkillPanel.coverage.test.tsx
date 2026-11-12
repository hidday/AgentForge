import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";

// Closes coverage gaps in DistilledSkillPanel.tsx not exercised by
// DistilledSkillPanel.test.tsx: the loading state (line 27) and the error
// state (line 38).
describe("DistilledSkillPanel – loading and error states", () => {
  it("shows a loading indicator when loading is true", () => {
    render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={null} loading={true} />,
    );

    expect(screen.getByText(/loading distilled skill/i)).toBeDefined();
  });

  it("shows the error message when error is set, even if a decision is also present", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={{
          shouldPersist: true,
          reason: "ok",
          taskCategory: null,
          name: null,
          description: null,
          displacedSkillId: null,
        }}
        error="Failed to load skill"
      />,
    );

    expect(screen.getByText("Failed to load skill")).toBeDefined();
    expect(screen.queryByText("Distilled Skill")).toBeNull();
  });

  it("prioritizes the loading state over the error state", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
        error="Should not be shown"
      />,
    );

    expect(screen.getByText(/loading distilled skill/i)).toBeDefined();
    expect(screen.queryByText("Should not be shown")).toBeNull();
  });
});
