import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactTabs } from "./ArtifactTabs.tsx";
import type { Artifact } from "@/api/client.ts";

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "a1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ArtifactTabs additional branches", () => {
  it("applies the waiting style for a 'partially_incorporated' disposition status", async () => {
    const artifacts = [
      makeArtifact({ type: "Plan", payloadJson: { summary: "plan" } }),
      makeArtifact({
        type: "PlanRevision",
        payloadJson: {
          dispositions: [
            {
              findingId: "F3",
              status: "partially_incorporated",
              rationale: "Some of it applied",
            },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));

    const badge = screen.getByText("partially incorporated");
    expect(badge.className).toContain("bg-state-waiting-bg");
    expect(badge.className).toContain("text-state-waiting");
  });

  it("applies the default fallback style for an unrecognized disposition status", async () => {
    const artifacts = [
      makeArtifact({ type: "Plan", payloadJson: { summary: "plan" } }),
      makeArtifact({
        type: "PlanRevision",
        payloadJson: {
          dispositions: [
            {
              findingId: "F4",
              status: "pending_review",
              rationale: "Still being looked at",
            },
          ],
        },
      }),
    ];
    render(<ArtifactTabs artifacts={artifacts} />);

    await userEvent.click(screen.getByRole("button", { name: "Plan Revision" }));

    const badge = screen.getByText("pending review");
    expect(badge.className).toContain("bg-surface-hover");
    expect(badge.className).toContain("text-text-muted");
  });
});
