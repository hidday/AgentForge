import { describe, it, expect, vi } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

interface FakeIssue {
  id: string;
  labelIds: string[];
  team: Promise<{ id: string; key: string } | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> } | null>;
}

function makeFakeIssue(overrides: Partial<FakeIssue> & { id: string }): FakeIssue {
  return {
    labelIds: [],
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

interface FakeSdk {
  issue: (id: string) => Promise<FakeIssue>;
  updateIssue: ReturnType<typeof vi.fn>;
  issueLabels: ReturnType<typeof vi.fn>;
  createIssueLabel: ReturnType<typeof vi.fn>;
}

function makeClient(sdk: Partial<FakeSdk> & { issue: (id: string) => Promise<FakeIssue> }) {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  (client as unknown as { sdk: Partial<FakeSdk> }).sdk = sdk;
  return { client, logger };
}

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache for later use", async () => {
    const issue = makeFakeIssue({
      id: "issue-1",
      labels: () =>
        Promise.resolve({
          nodes: [
            { id: "l1", name: "bug" },
            { id: "l2", name: "urgent" },
          ],
        }),
    });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client } = makeClient({ issue: () => Promise.resolve(issue), updateIssue });

    const names = await client.listLabels("issue-1");
    expect(names).toEqual(["bug", "urgent"]);

    // Removing a label that was populated into the cache by listLabels should
    // use the cache instead of re-fetching labels().
    const labelsSpy = vi.spyOn(issue, "labels");
    await client.removeLabel("issue-1", "bug");
    expect(labelsSpy).not.toHaveBeenCalled();
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
  });

  it("returns an empty array when the labels connection has no nodes", async () => {
    const issue = makeFakeIssue({ id: "issue-2", labels: () => Promise.resolve(null) });
    const { client } = makeClient({ issue: () => Promise.resolve(issue) });

    const names = await client.listLabels("issue-2");
    expect(names).toEqual([]);
  });
});

describe("RealLinearClient.addLabel", () => {
  it("resolves an existing label via issueLabels and adds it when not already on the issue", async () => {
    const issue = makeFakeIssue({ id: "issue-1", labelIds: ["existing-id"] });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
    const { client } = makeClient({
      issue: () => Promise.resolve(issue),
      updateIssue,
      issueLabels,
    });

    await client.addLabel("issue-1", "bug");

    expect(issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "bug" } } });
    expect(updateIssue).toHaveBeenCalledWith("issue-1", {
      labelIds: ["existing-id", "label-id"],
    });
  });

  it("does not call updateIssue when the label is already present on the issue", async () => {
    const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-id"] });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
    const { client } = makeClient({
      issue: () => Promise.resolve(issue),
      updateIssue,
      issueLabels,
    });

    await client.addLabel("issue-1", "bug");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("creates a new label (with the issue's team id) when none exists yet", async () => {
    const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id", name: "feature" }),
    });
    const { client, logger } = makeClient({
      issue: () => Promise.resolve(issue),
      updateIssue,
      issueLabels,
      createIssueLabel,
    });

    await client.addLabel("issue-1", "feature");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "feature", teamId: "team-1" });
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ labelName: "feature", labelId: "new-label-id" }),
      "Created new Linear label",
    );
  });

  it("creates a new label without a teamId when the issue has no team", async () => {
    const issue = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id", name: "feature" }),
    });
    const { client } = makeClient({
      issue: () => Promise.resolve(issue),
      updateIssue,
      issueLabels,
      createIssueLabel,
    });

    await client.addLabel("issue-1", "feature");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "feature" });
  });

  it("throws when label creation does not yield a created label", async () => {
    const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(undefined) });
    const { client } = makeClient({
      issue: () => Promise.resolve(issue),
      issueLabels,
      createIssueLabel,
    });

    await expect(client.addLabel("issue-1", "feature")).rejects.toThrow(
      "Failed to create label: feature",
    );
  });

  it("reuses a cached label id across calls instead of querying issueLabels again", async () => {
    const issue1 = makeFakeIssue({ id: "issue-1", labelIds: [] });
    const issue2 = makeFakeIssue({ id: "issue-2", labelIds: [] });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
    const { client } = makeClient({
      issue: (id: string) => Promise.resolve(id === "issue-1" ? issue1 : issue2),
      updateIssue,
      issueLabels,
    });

    await client.addLabel("issue-1", "bug");
    await client.addLabel("issue-2", "bug");

    expect(issueLabels).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenCalledWith("issue-2", { labelIds: ["label-id"] });
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("looks up the label by name, caches it, and removes it from the issue", async () => {
    const issue = makeFakeIssue({
      id: "issue-1",
      labelIds: ["label-id", "other-id"],
      labels: () => Promise.resolve({ nodes: [{ id: "label-id", name: "bug" }] }),
    });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client } = makeClient({ issue: () => Promise.resolve(issue), updateIssue });

    await client.removeLabel("issue-1", "bug");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["other-id"] });
  });

  it("does nothing when the named label is not found on the issue", async () => {
    const issue = makeFakeIssue({
      id: "issue-1",
      labelIds: ["other-id"],
      labels: () => Promise.resolve({ nodes: [] }),
    });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client } = makeClient({ issue: () => Promise.resolve(issue), updateIssue });

    await client.removeLabel("issue-1", "missing-label");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("handles a null labels connection as no match found", async () => {
    const issue = makeFakeIssue({
      id: "issue-1",
      labelIds: ["other-id"],
      labels: () => Promise.resolve(null),
    });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client } = makeClient({ issue: () => Promise.resolve(issue), updateIssue });

    await client.removeLabel("issue-1", "missing-label");

    expect(updateIssue).not.toHaveBeenCalled();
  });
});
