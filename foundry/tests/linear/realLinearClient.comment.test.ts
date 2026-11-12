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

describe("RealLinearClient.postComment", () => {
  it("creates a comment via the SDK and logs it", async () => {
    const createComment = vi.fn().mockResolvedValue({ success: true });
    const logger = makeLogger();
    const client = new RealLinearClient("test-key", logger as never);
    (client as unknown as { sdk: { createComment: typeof createComment } }).sdk = {
      createComment,
    };

    await client.postComment("issue-1", "Hello from the agent");

    expect(createComment).toHaveBeenCalledWith({
      issueId: "issue-1",
      body: "Hello from the agent",
    });
    expect(logger.debug).toHaveBeenCalledWith(
      { issueId: "issue-1" },
      "Posted comment to Linear issue",
    );
  });

  it("propagates an error thrown by the SDK", async () => {
    const createComment = vi.fn().mockRejectedValue(new Error("Linear API down"));
    const logger = makeLogger();
    const client = new RealLinearClient("test-key", logger as never);
    (client as unknown as { sdk: { createComment: typeof createComment } }).sdk = {
      createComment,
    };

    await expect(client.postComment("issue-1", "body")).rejects.toThrow("Linear API down");
    expect(logger.debug).not.toHaveBeenCalled();
  });
});
