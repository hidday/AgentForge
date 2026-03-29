import { describe, it, expect } from "vitest";
import { parseLinearCommand } from "../../src/linear/linearCommandParser.js";

describe("parseLinearCommand", () => {
  describe("reject-plan", () => {
    it("parses '/reject-plan' with body: undefined", () => {
      const result = parseLinearCommand("/reject-plan");
      expect(result).toEqual({ type: "reject-plan", body: undefined });
    });

    it("parses '/reject-plan Use OAuth2 not API keys' with body captured", () => {
      const result = parseLinearCommand("/reject-plan Use OAuth2 not API keys");
      expect(result).toEqual({ type: "reject-plan", body: "Use OAuth2 not API keys" });
    });

    it("sets body to undefined for whitespace-only remainder", () => {
      const result = parseLinearCommand("/reject-plan   ");
      expect(result).toEqual({ type: "reject-plan", body: undefined });
    });

    it("captures multi-word body", () => {
      const result = parseLinearCommand("/reject-plan The auth flow should use OAuth2");
      expect(result).toEqual({
        type: "reject-plan",
        body: "The auth flow should use OAuth2",
      });
    });

    it("ignores text on lines after the first line (only first line is command)", () => {
      const result = parseLinearCommand(
        "/reject-plan Use OAuth2\nAdditional details here",
      );
      expect(result).toEqual({ type: "reject-plan", body: "Use OAuth2" });
    });

    it("trims leading/trailing whitespace from body", () => {
      const result = parseLinearCommand("/reject-plan   trimmed body   ");
      expect(result).toEqual({ type: "reject-plan", body: "trimmed body" });
    });
  });

  describe("other commands remain unchanged", () => {
    it("parses '/approve-plan'", () => {
      const result = parseLinearCommand("/approve-plan");
      expect(result).toEqual({ type: "approve-plan" });
    });

    it("parses '/ai-plan'", () => {
      const result = parseLinearCommand("/ai-plan");
      expect(result).toEqual({ type: "ai-plan" });
    });

    it("parses '/pause-ai'", () => {
      const result = parseLinearCommand("/pause-ai");
      expect(result).toEqual({ type: "pause-ai" });
    });

    it("returns null for non-command text", () => {
      const result = parseLinearCommand("This is a regular comment");
      expect(result).toBeNull();
    });

    it("returns unknown for unknown slash command", () => {
      const result = parseLinearCommand("/unknown-command");
      expect(result).toEqual({ type: "unknown", raw: "/unknown-command" });
    });
  });
});
