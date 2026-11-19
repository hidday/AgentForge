import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";

describe("DistilledSkillPanel - additional branch coverage", () => {
  it("renders a loading indicator when loading is true", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
      />,
    );

    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
  });

  it("renders the error message when error is set, instead of loading or skill content", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        error="Failed to fetch skill"
      />,
    );

    expect(screen.getByText("Failed to fetch skill")).toBeDefined();
    expect(screen.queryByText(/Loading distilled skill/i)).toBeNull();
  });
});
