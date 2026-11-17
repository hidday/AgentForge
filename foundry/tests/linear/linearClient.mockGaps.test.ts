import { describe, it, expect } from "vitest";
import { MockLinearClient } from "../../src/linear/linearClient.js";

function seed(client: MockLinearClient, overrides: Partial<Parameters<MockLinearClient["seedIssue"]>[0]> = {}) {
  client.seedIssue({
    id: "LIN-1",
    title: "Title",
    description: "Desc",
    branchName: "ai/lin-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  });
}

describe("MockLinearClient.removeLabel and listLabels", () => {
  it("removes an existing label from a seeded issue", async () => {
    const client = new MockLinearClient();
    seed(client, { labels: ["bug", "ai:todo"] });

    await client.removeLabel("LIN-1", "bug");

    await expect(client.listLabels("LIN-1")).resolves.toEqual(["ai:todo"]);
  });

  it("is a no-op when removing a label from an issue that was never seeded", async () => {
    const client = new MockLinearClient();
    await expect(client.removeLabel("missing-issue", "bug")).resolves.toBeUndefined();
  });

  it("returns an empty array from listLabels for an issue that was never seeded", async () => {
    const client = new MockLinearClient();
    await expect(client.listLabels("missing-issue")).resolves.toEqual([]);
  });

  it("returns a copy of labels from listLabels so callers cannot mutate internal state", async () => {
    const client = new MockLinearClient();
    seed(client, { labels: ["a"] });

    const labels = await client.listLabels("LIN-1");
    labels.push("mutated");

    await expect(client.listLabels("LIN-1")).resolves.toEqual(["a"]);
  });
});
