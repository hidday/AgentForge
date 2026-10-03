import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client.ts";

function mockFetchOnce(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const json = vi.fn().mockResolvedValue(body);
  const res = { ok, status, json };
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(res);
  return res;
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("GET requests", () => {
    it("getRuns() with no filter calls GET /api/runs with empty headers", async () => {
      mockFetchOnce(200, { runs: [] });
      const result = await api.getRuns();
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
      expect(result).toEqual({ runs: [] });
    });

    it("getRuns(state) appends the state query param", async () => {
      mockFetchOnce(200, { runs: [{ id: "r1" }] });
      const result = await api.getRuns("AIBlocked");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs?state=AIBlocked", {
        headers: {},
      });
      expect(result).toEqual({ runs: [{ id: "r1" }] });
    });

    it("getRun(id) calls GET /api/runs/:id", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      mockFetchOnce(200, payload);
      const result = await api.getRun("r1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1", { headers: {} });
      expect(result).toEqual(payload);
    });

    it("getRunSkills(runId) calls GET /api/runs/:runId/skills", async () => {
      const payload = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
      mockFetchOnce(200, payload);
      const result = await api.getRunSkills("r1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/skills", { headers: {} });
      expect(result).toEqual(payload);
    });

    it("getArtifacts(runId) calls GET /api/runs/:runId/artifacts", async () => {
      mockFetchOnce(200, { artifacts: [] });
      const result = await api.getArtifacts("r1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", { headers: {} });
      expect(result).toEqual({ artifacts: [] });
    });

    it("getEvents(runId) calls GET /api/runs/:runId/events", async () => {
      mockFetchOnce(200, { events: [] });
      const result = await api.getEvents("r1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/events", { headers: {} });
      expect(result).toEqual({ events: [] });
    });

    it("getActiveProcesses() with no runId omits the query param", async () => {
      mockFetchOnce(200, { processes: [] });
      const result = await api.getActiveProcesses();
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
      expect(result).toEqual({ processes: [] });
    });

    it("getActiveProcesses(runId) appends the runId query param", async () => {
      mockFetchOnce(200, { processes: [{ id: "p1" }] });
      const result = await api.getActiveProcesses("r1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes?runId=r1", {
        headers: {},
      });
      expect(result).toEqual({ processes: [{ id: "p1" }] });
    });

    it("getProcessOutput(processId) calls GET /api/processes/:id/output", async () => {
      mockFetchOnce(200, { processId: "p1", output: "hello" });
      const result = await api.getProcessOutput("p1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes/p1/output", {
        headers: {},
      });
      expect(result).toEqual({ processId: "p1", output: "hello" });
    });

    it("fetchPendingIssues() calls GET /api/linear/pending", async () => {
      mockFetchOnce(200, { issues: [] });
      const result = await api.fetchPendingIssues();
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
      expect(result).toEqual({ issues: [] });
    });
  });

  describe("POST requests with a body", () => {
    it("approvePlan(runId, note) sends the note and sets JSON content-type", async () => {
      mockFetchOnce(200, { ok: true, state: "Implementing" });
      const result = await api.approvePlan("r1", "looks good");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
      expect(result).toEqual({ ok: true, state: "Implementing" });
    });

    it("approvePlan(runId) with no note omits the field (falsy -> undefined)", async () => {
      mockFetchOnce(200, { ok: true, state: "Implementing" });
      await api.approvePlan("r1");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/approve-plan",
        expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
      );
    });

    it("rejectPlan defaults mode to 'iterate' when omitted", async () => {
      mockFetchOnce(200, { ok: true, state: "PlanRevision" });
      await api.rejectPlan("r1", "needs work");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: "needs work", mode: "iterate" }),
      });
    });

    it("rejectPlan forwards an explicit mode", async () => {
      mockFetchOnce(200, { ok: true, state: "PlanRevision" });
      await api.rejectPlan("r1", "start over", "fresh");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/reject-plan",
        expect.objectContaining({
          body: JSON.stringify({ context: "start over", mode: "fresh" }),
        }),
      );
    });

    it("reReviewPlan(runId, note) posts to the re-review-plan action", async () => {
      mockFetchOnce(200, { ok: true, runId: "r1" });
      const result = await api.reReviewPlan("r1", "re-check this");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "re-check this" }),
      });
      expect(result).toEqual({ ok: true, runId: "r1" });
    });

    it("revisePlan(runId, note) posts to the revise-plan action", async () => {
      mockFetchOnce(200, { ok: true, runId: "r1" });
      const result = await api.revisePlan("r1", "revise this");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "revise this" }),
      });
      expect(result).toEqual({ ok: true, runId: "r1" });
    });

    it("ingestIssues(issueIds) sends the array as JSON", async () => {
      mockFetchOnce(200, { ok: true, started: ["a"], skipped: ["b"] });
      const result = await api.ingestIssues(["a", "b"]);
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["a", "b"] }),
      });
      expect(result).toEqual({ ok: true, started: ["a"], skipped: ["b"] });
    });

    it("answerQuestions(runId, answers) sends the answers array", async () => {
      const answers = [{ questionId: "q1", answer: "yes" }];
      mockFetchOnce(200, { ok: true, run: { id: "r1" } });
      const result = await api.answerQuestions("r1", answers);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/answer-questions",
        {
          headers: { "Content-Type": "application/json" },
          method: "POST",
          body: JSON.stringify({ answers }),
        },
      );
      expect(result).toEqual({ ok: true, run: { id: "r1" } });
    });

    it("sendChatMessage(runId, message) posts to the chat endpoint", async () => {
      mockFetchOnce(200, { reply: "hi there", durationMs: 42 });
      const result = await api.sendChatMessage("r1", "hello agent");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "hello agent" }),
      });
      expect(result).toEqual({ reply: "hi there", durationMs: 42 });
    });
  });

  describe("POST requests without a body", () => {
    it("approveReview(runId) sends no Content-Type header and no body", async () => {
      mockFetchOnce(200, { ok: true, state: "Done" });
      const result = await api.approveReview("r1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true, state: "Done" });
    });

    it("pauseRun(runId) posts with no body", async () => {
      mockFetchOnce(200, { ok: true });
      const result = await api.pauseRun("r1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/pause", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true });
    });

    it("resumeRun(runId) posts with no body", async () => {
      mockFetchOnce(200, { ok: true });
      const result = await api.resumeRun("r1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/resume", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true });
    });

    it("retryStage(runId) posts with no body", async () => {
      mockFetchOnce(200, { ok: true, state: "Implementing", retrying: true });
      const result = await api.retryStage("r1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/retry", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true, state: "Implementing", retrying: true });
    });
  });

  describe("error handling", () => {
    it("throws the server-provided error message on a non-ok response", async () => {
      mockFetchOnce(400, { error: "Run is already approved" }, false);
      await expect(api.approvePlan("r1")).rejects.toThrow("Run is already approved");
    });

    it("falls back to an HTTP status message when the error body has no 'error' field", async () => {
      mockFetchOnce(500, { message: "oops" }, false);
      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("falls back to an HTTP status message when the error body isn't valid JSON", async () => {
      const json = vi.fn().mockRejectedValue(new Error("invalid json"));
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json,
      });
      await expect(api.getRun("r1")).rejects.toThrow("HTTP 503");
    });

    it("propagates a network-level rejection from fetch itself", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("network down"),
      );
      await expect(api.getRuns()).rejects.toThrow("network down");
    });
  });
});
