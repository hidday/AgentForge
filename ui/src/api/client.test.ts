import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "./client";

function mockFetchOnce(options: {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
}) {
  const jsonImpl = options.json ?? (() => Promise.resolve({}));
  const res = {
    ok: options.ok,
    status: options.status ?? (options.ok ? 200 : 500),
    json: vi.fn(jsonImpl),
  };
  (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(res);
  return res;
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("request() internals", () => {
    it("does not set Content-Type when there is no body (GET)", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ runs: [] }) });
      await api.getRuns();
      expect(fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
    });

    it("sets Content-Type: application/json when a body is present", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "x" }) });
      await api.approvePlan("run-1", "note");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "note" }),
      });
    });

    it("returns parsed JSON on success", async () => {
      const payload = { runs: [{ id: "1" }] };
      mockFetchOnce({ ok: true, json: () => Promise.resolve(payload) });
      const result = await api.getRuns();
      expect(result).toEqual(payload);
    });

    it("throws using the error field from the JSON body on failure", async () => {
      mockFetchOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "bad request" }),
      });
      await expect(api.getRuns()).rejects.toThrow("bad request");
    });

    it("falls back to HTTP ${status} when the error body has no error field", async () => {
      mockFetchOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ somethingElse: true }),
      });
      await expect(api.getRuns()).rejects.toThrow("HTTP 404");
    });

    it("falls back to HTTP ${status} when res.json() itself rejects", async () => {
      mockFetchOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("invalid json")),
      });
      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });
  });

  describe("getRuns", () => {
    it("calls /runs with no query string when no state is passed", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ runs: [] }) });
      await api.getRuns();
      expect(fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
    });

    it("appends ?state= when a state arg is passed", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ runs: [] }) });
      await api.getRuns("pending");
      expect(fetch).toHaveBeenCalledWith("/api/runs?state=pending", { headers: {} });
    });
  });

  describe("getRun", () => {
    it("calls /runs/:id", async () => {
      const payload = { run: {}, artifacts: [], events: [] };
      mockFetchOnce({ ok: true, json: () => Promise.resolve(payload) });
      const result = await api.getRun("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1", { headers: {} });
      expect(result).toEqual(payload);
    });
  });

  describe("getRunSkills", () => {
    it("calls /runs/:runId/skills", async () => {
      mockFetchOnce({
        ok: true,
        json: () =>
          Promise.resolve({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
      });
      await api.getRunSkills("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/skills", { headers: {} });
    });
  });

  describe("getArtifacts", () => {
    it("calls /runs/:runId/artifacts", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ artifacts: [] }) });
      await api.getArtifacts("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/artifacts", { headers: {} });
    });
  });

  describe("getEvents", () => {
    it("calls /runs/:runId/events", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ events: [] }) });
      await api.getEvents("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/events", { headers: {} });
    });
  });

  describe("approvePlan", () => {
    it("POSTs with note when provided", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "approved" }) });
      await api.approvePlan("run-1", "looks good");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
    });

    it("sends note: undefined when note is omitted", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "approved" }) });
      await api.approvePlan("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });

    it("sends note: undefined when note is empty string (falsy)", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "approved" }) });
      await api.approvePlan("run-1", "");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("rejectPlan", () => {
    it("sends context and mode='iterate' by default", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "rejected" }) });
      await api.rejectPlan("run-1", "needs work");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: "needs work", mode: "iterate" }),
      });
    });

    it("sends context: undefined and explicit mode='fresh'", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "rejected" }) });
      await api.rejectPlan("run-1", undefined, "fresh");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: undefined, mode: "fresh" }),
      });
    });

    it("defaults mode to 'iterate' when no args are passed at all", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "rejected" }) });
      await api.rejectPlan("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: undefined, mode: "iterate" }),
      });
    });
  });

  describe("reReviewPlan", () => {
    it("POSTs with note when provided", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) });
      await api.reReviewPlan("run-1", "re-review please");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "re-review please" }),
      });
    });

    it("sends note: undefined when note is omitted", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) });
      await api.reReviewPlan("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("revisePlan", () => {
    it("POSTs with note when provided", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) });
      await api.revisePlan("run-1", "revise please");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "revise please" }),
      });
    });

    it("sends note: undefined when note is omitted", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) });
      await api.revisePlan("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("approveReview", () => {
    it("POSTs with no body", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "approved" }) });
      await api.approveReview("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
    });
  });

  describe("pauseRun", () => {
    it("POSTs with no body", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
      await api.pauseRun("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/pause", {
        headers: {},
        method: "POST",
      });
    });
  });

  describe("resumeRun", () => {
    it("POSTs with no body", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
      await api.resumeRun("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/resume", {
        headers: {},
        method: "POST",
      });
    });
  });

  describe("retryStage", () => {
    it("POSTs with no body", async () => {
      mockFetchOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, state: "running", retrying: true }),
      });
      await api.retryStage("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/retry", {
        headers: {},
        method: "POST",
      });
    });
  });

  describe("getActiveProcesses", () => {
    it("calls /processes with no query string when no runId is passed", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ processes: [] }) });
      await api.getActiveProcesses();
      expect(fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
    });

    it("appends ?runId= when a runId arg is passed", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ processes: [] }) });
      await api.getActiveProcesses("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/processes?runId=run-1", { headers: {} });
    });
  });

  describe("getProcessOutput", () => {
    it("calls /processes/:processId/output", async () => {
      mockFetchOnce({
        ok: true,
        json: () => Promise.resolve({ processId: "p-1", output: "log text" }),
      });
      await api.getProcessOutput("p-1");
      expect(fetch).toHaveBeenCalledWith("/api/processes/p-1/output", { headers: {} });
    });
  });

  describe("fetchPendingIssues", () => {
    it("calls /linear/pending", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ issues: [] }) });
      await api.fetchPendingIssues();
      expect(fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
    });
  });

  describe("ingestIssues", () => {
    it("POSTs issueIds in the body", async () => {
      mockFetchOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, started: ["a"], skipped: [] }),
      });
      await api.ingestIssues(["a", "b"]);
      expect(fetch).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["a", "b"] }),
      });
    });
  });

  describe("answerQuestions", () => {
    it("POSTs answers in the body", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, run: {} }) });
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("run-1", answers);
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/answer-questions", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ answers }),
      });
    });
  });

  describe("sendChatMessage", () => {
    it("POSTs message in the body", async () => {
      mockFetchOnce({
        ok: true,
        json: () => Promise.resolve({ reply: "hi", durationMs: 42 }),
      });
      const result = await api.sendChatMessage("run-1", "hello there");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "hello there" }),
      });
      expect(result).toEqual({ reply: "hi", durationMs: 42 });
    });
  });
});
