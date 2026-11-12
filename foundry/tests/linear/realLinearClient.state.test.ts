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
  team: Promise<{ id: string; key: string } | null>;
}

interface FakeTeam {
  id: string;
  states: ReturnType<typeof vi.fn>;
}

function makeClient(sdk: {
  issue: (id: string) => Promise<FakeIssue>;
  team?: (id: string) => Promise<FakeTeam>;
  updateIssue?: ReturnType<typeof vi.fn>;
}) {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  (client as unknown as { sdk: typeof sdk }).sdk = sdk;
  return { client, logger };
}

describe("RealLinearClient.updateIssueState", () => {
  it("warns and does nothing when the issue has no team", async () => {
    const issue: FakeIssue = { id: "issue-1", team: Promise.resolve(null) };
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client, logger } = makeClient({ issue: () => Promise.resolve(issue), updateIssue });

    await client.updateIssueState("issue-1", "In Progress");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1" },
      "Cannot update state: issue has no team",
    );
  });

  it("warns and does nothing when the requested state name isn't found for the team", async () => {
    const issue: FakeIssue = { id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) };
    const states = vi.fn().mockResolvedValue({ nodes: [{ id: "s1", name: "Todo" }] });
    const team = vi.fn().mockResolvedValue({ id: "team-1", states });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client, logger } = makeClient({
      issue: () => Promise.resolve(issue),
      team,
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Nonexistent State");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Nonexistent State", teamId: "team-1" },
      "Could not find workflow state by name",
    );
  });

  it("resolves the state id and calls updateIssue on success", async () => {
    const issue: FakeIssue = { id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) };
    const states = vi.fn().mockResolvedValue({
      nodes: [
        { id: "s1", name: "Todo" },
        { id: "s2", name: "In Progress" },
      ],
    });
    const team = vi.fn().mockResolvedValue({ id: "team-1", states });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client, logger } = makeClient({
      issue: () => Promise.resolve(issue),
      team,
      updateIssue,
    });

    await client.updateIssueState("issue-1", "In Progress");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s2" });
    expect(logger.debug).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "In Progress", stateId: "s2" },
      "Updated Linear issue state",
    );
  });

  it("caches the team's state map so a second call for the same team doesn't refetch states", async () => {
    const issue1: FakeIssue = {
      id: "issue-1",
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    };
    const issue2: FakeIssue = {
      id: "issue-2",
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    };
    const states = vi.fn().mockResolvedValue({ nodes: [{ id: "s1", name: "Done" }] });
    const team = vi.fn().mockResolvedValue({ id: "team-1", states });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client } = makeClient({
      issue: (id: string) => Promise.resolve(id === "issue-1" ? issue1 : issue2),
      team,
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Done");
    await client.updateIssueState("issue-2", "Done");

    expect(team).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { stateId: "s1" });
  });

  it("treats a null states connection as having no states", async () => {
    const issue: FakeIssue = { id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) };
    const states = vi.fn().mockResolvedValue(null);
    const team = vi.fn().mockResolvedValue({ id: "team-1", states });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client, logger } = makeClient({
      issue: () => Promise.resolve(issue),
      team,
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Done");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
