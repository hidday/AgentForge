import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client.ts";

function mockFetchOnce(response: {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response);
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("request() behavior via getRuns (GET, no body)", () => {
    it("builds the correct URL with no query string when state is omitted", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ runs: [] }) });
      await api.getRuns();
      expect(fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
    });

    it("builds the correct URL with a state query param", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ runs: [] }) });
      await api.getRuns("Planning");
      expect(fetch).toHaveBeenCalledWith("/api/runs?state=Planning", { headers: {} });
    });

    it("does not set Content-Type header when there is no body", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ runs: [] }) });
      await api.getRuns();
      const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(callArgs.headers).toEqual({});
    });

    it("resolves with the parsed JSON body on success", async () => {
      const runs = [{ id: "r1" }];
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ runs }) });
      const result = await api.getRuns();
      expect(result).toEqual({ runs });
    });

    it("throws an Error using the response's error field on non-2xx status", async () => {
      mockFetchOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Bad request" }),
      });
      await expect(api.getRuns()).rejects.toThrow("Bad request");
    });

    it("throws an Error with the HTTP status when the error body has no 'error' field", async () => {
      mockFetchOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });
      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("throws an Error with the HTTP status when the error body cannot be parsed as JSON", async () => {
      mockFetchOnce({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("invalid json")),
      });
      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });

    it("propagates a network rejection", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network down"));
      await expect(api.getRuns()).rejects.toThrow("Network down");
    });
  });

  describe("getRun", () => {
    it("requests the correct URL and returns parsed body", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      mockFetchOnce({ ok: true, json: () => Promise.resolve(payload) });
      const result = await api.getRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1", { headers: {} });
      expect(result).toEqual(payload);
    });
  });

  describe("getRunSkills", () => {
    it("requests the correct URL", async () => {
      const payload = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
      mockFetchOnce({ ok: true, json: () => Promise.resolve(payload) });
      const result = await api.getRunSkills("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/skills", { headers: {} });
      expect(result).toEqual(payload);
    });
  });

  describe("getArtifacts", () => {
    it("requests the correct URL", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ artifacts: [] }) });
      const result = await api.getArtifacts("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", { headers: {} });
      expect(result).toEqual({ artifacts: [] });
    });
  });

  describe("getEvents", () => {
    it("requests the correct URL", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ events: [] }) });
      const result = await api.getEvents("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/events", { headers: {} });
      expect(result).toEqual({ events: [] });
    });
  });

  describe("approvePlan", () => {
    it("POSTs with note when provided", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "Implementing" }) });
      const result = await api.approvePlan("r1", "looks good");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
      expect(result).toEqual({ ok: true, state: "Implementing" });
    });

    it("sends undefined note when omitted", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "Implementing" }) });
      await api.approvePlan("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("rejectPlan", () => {
    it("POSTs with context and mode when provided", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "PlanRevision" }) });
      await api.rejectPlan("r1", "needs changes", "fresh");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: "needs changes", mode: "fresh" }),
      });
    });

    it("defaults mode to 'iterate' when omitted", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "PlanRevision" }) });
      await api.rejectPlan("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: undefined, mode: "iterate" }),
      });
    });
  });

  describe("reReviewPlan", () => {
    it("POSTs with note", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "r1" }) });
      await api.reReviewPlan("r1", "re-review please");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "re-review please" }),
      });
    });

    it("sends undefined note when omitted", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "r1" }) });
      await api.reReviewPlan("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("revisePlan", () => {
    it("POSTs with note", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "r1" }) });
      await api.revisePlan("r1", "revise please");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "revise please" }),
      });
    });

    it("sends undefined note when omitted", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "r1" }) });
      await api.revisePlan("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("approveReview", () => {
    it("POSTs with no body", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "Implementing" }) });
      const result = await api.approveReview("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true, state: "Implementing" });
    });
  });

  describe("pauseRun / resumeRun / retryStage", () => {
    it("pauseRun POSTs to the pause endpoint", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
      await api.pauseRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/pause", {
        headers: {},
        method: "POST",
      });
    });

    it("resumeRun POSTs to the resume endpoint", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
      await api.resumeRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/resume", {
        headers: {},
        method: "POST",
      });
    });

    it("retryStage POSTs to the retry endpoint", async () => {
      mockFetchOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, state: "Implementing", retrying: true }),
      });
      const result = await api.retryStage("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/retry", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true, state: "Implementing", retrying: true });
    });
  });

  describe("getActiveProcesses", () => {
    it("requests without a query string when runId is omitted", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ processes: [] }) });
      await api.getActiveProcesses();
      expect(fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
    });

    it("requests with a runId query string when provided", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ processes: [] }) });
      await api.getActiveProcesses("r1");
      expect(fetch).toHaveBeenCalledWith("/api/processes?runId=r1", { headers: {} });
    });
  });

  describe("getProcessOutput", () => {
    it("requests the correct URL", async () => {
      mockFetchOnce({
        ok: true,
        json: () => Promise.resolve({ processId: "p1", output: "log output" }),
      });
      const result = await api.getProcessOutput("p1");
      expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
      expect(result).toEqual({ processId: "p1", output: "log output" });
    });
  });

  describe("fetchPendingIssues", () => {
    it("requests the linear pending endpoint", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ issues: [] }) });
      const result = await api.fetchPendingIssues();
      expect(fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
      expect(result).toEqual({ issues: [] });
    });
  });

  describe("ingestIssues", () => {
    it("POSTs the issue ids", async () => {
      mockFetchOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, started: ["i1"], skipped: [] }),
      });
      const result = await api.ingestIssues(["i1", "i2"]);
      expect(fetch).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["i1", "i2"] }),
      });
      expect(result).toEqual({ ok: true, started: ["i1"], skipped: [] });
    });
  });

  describe("answerQuestions", () => {
    it("POSTs the answers array", async () => {
      const answers = [{ questionId: "q1", answer: "yes" }];
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, run: { id: "r1" } }) });
      await api.answerQuestions("r1", answers);
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/answer-questions", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ answers }),
      });
    });
  });

  describe("sendChatMessage", () => {
    it("POSTs the message and returns the reply", async () => {
      mockFetchOnce({
        ok: true,
        json: () => Promise.resolve({ reply: "Hi there", durationMs: 42 }),
      });
      const result = await api.sendChatMessage("r1", "Hello");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "Hello" }),
      });
      expect(result).toEqual({ reply: "Hi there", durationMs: 42 });
    });

    it("throws with the server error message on failure", async () => {
      mockFetchOnce({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ error: "Message too long" }),
      });
      await expect(api.sendChatMessage("r1", "x".repeat(10000))).rejects.toThrow(
        "Message too long",
      );
    });
  });
});
