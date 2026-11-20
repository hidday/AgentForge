import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DistilledSkillPanel } from "./DistilledSkillPanel.tsx";
import type { DistillationDecision, SkillDocument } from "@/api/client.ts";

vi.mock("@/components/Markdown.tsx", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

// Additive coverage for DistilledSkillPanel.tsx. See DistilledSkillPanel.test.tsx
// for the main suite; this closes the remaining loading/error branch gaps
// without touching the existing assertions there.
describe("DistilledSkillPanel – loading and error states", () => {
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

  it("loading takes priority over an error prop", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={true}
        error="should not show"
      />,
    );

    expect(screen.getByText(/Loading distilled skill/i)).toBeDefined();
    expect(screen.queryByText("should not show")).toBeNull();
  });

  it("renders the error message when error is set and not loading", () => {
    render(
      <DistilledSkillPanel
        distilledSkill={null}
        distillationDecision={null}
        loading={false}
        error="Failed to load distilled skill"
      />,
    );

    expect(screen.getByText("Failed to load distilled skill")).toBeDefined();
  });

  it("renders nothing when neither loading nor error nor a persisted decision are present", () => {
    const { container } = render(
      <DistilledSkillPanel distilledSkill={null} distillationDecision={null} />,
    );

    expect(container.firstChild).toBeNull();
  });
});

describe("DistilledSkillPanel – skillName/skillDescription fallback chain and displaced-skill note", () => {
  it("falls all the way back to the 'distilled-skill' default name when nothing else provides one", () => {
    const decision: DistillationDecision = {
      shouldPersist: true,
      reason: "",
      taskCategory: null,
      name: null,
      description: null,
      displacedSkillId: null,
    };
    render(<DistilledSkillPanel distilledSkill={null} distillationDecision={decision} />);

    expect(screen.getByText("distilled-skill")).toBeDefined();
  });

  it("falls back to the skill's taskCategory for the name when the skill has no name", () => {
    const decision: DistillationDecision = {
      shouldPersist: true,
      reason: "",
      taskCategory: null,
      name: null,
      description: null,
      displacedSkillId: null,
    };
    const skill: SkillDocument = {
      id: "s1",
      repoSlug: "org/repo",
      name: null,
      description: null,
      taskCategory: "deploy-tooling",
      skillMarkdown: "# content",
      utilityScore: 0,
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    };
    render(<DistilledSkillPanel distilledSkill={skill} distillationDecision={decision} />);

    expect(screen.getAllByText("deploy-tooling").length).toBeGreaterThan(0);
  });

  it("falls back to the decision's taskCategory for the name when skill and decision name are both absent", () => {
    const decision: DistillationDecision = {
      shouldPersist: true,
      reason: "",
      taskCategory: "infra-footguns",
      name: null,
      description: null,
      displacedSkillId: null,
    };
    render(<DistilledSkillPanel distilledSkill={null} distillationDecision={decision} />);

    expect(screen.getAllByText("infra-footguns").length).toBeGreaterThan(0);
  });

  it("uses the decision's description when the skill has none", () => {
    const decision: DistillationDecision = {
      shouldPersist: true,
      reason: "",
      taskCategory: "x",
      name: "x-skill",
      description: "Decision-provided description",
      displacedSkillId: null,
    };
    const skill: SkillDocument = {
      id: "s1",
      repoSlug: "org/repo",
      name: null,
      description: null,
      taskCategory: "x",
      skillMarkdown: "# content",
      utilityScore: 0,
      lastUsedAt: "2026-01-01T00:00:00.000Z",
    };
    render(<DistilledSkillPanel distilledSkill={skill} distillationDecision={decision} />);

    expect(screen.getByText("Decision-provided description")).toBeDefined();
  });

  it("shows the truncated displaced skill id when one is present", () => {
    const decision: DistillationDecision = {
      shouldPersist: true,
      reason: "",
      taskCategory: "x",
      name: "x-skill",
      description: null,
      displacedSkillId: "0123456789abcdef",
    };
    render(<DistilledSkillPanel distilledSkill={null} distillationDecision={decision} />);

    expect(screen.getByText(/Displaced skill:/)).toBeDefined();
    expect(screen.getByText(/01234567/)).toBeDefined();
  });

  it("shows no displaced-skill note when displacedSkillId is null", () => {
    const decision: DistillationDecision = {
      shouldPersist: true,
      reason: "",
      taskCategory: "x",
      name: "x-skill",
      description: null,
      displacedSkillId: null,
    };
    render(<DistilledSkillPanel distilledSkill={null} distillationDecision={decision} />);

    expect(screen.queryByText(/Displaced skill:/)).toBeNull();
  });
});
