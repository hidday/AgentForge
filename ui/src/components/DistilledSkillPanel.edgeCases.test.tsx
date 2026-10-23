import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";

describe("DistilledSkillPanel edge cases", () => {
  it("shows a loading indicator and nothing else when loading is true", () => {
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

  it("shows the error message and nothing else when error is set, even with loading true", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to load skills"
      />,
    );
    expect(screen.getByText("Failed to load skills")).toBeDefined();
    expect(screen.queryByText(/Loading distilled skill/i)).toBeNull();
  });

  it("prioritizes the loading state over an error when both are set", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
        error="Should not show"
      />,
    );
    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
    expect(screen.queryByText("Should not show")).toBeNull();
  });
});
