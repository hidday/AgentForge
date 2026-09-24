import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client.ts";

function mockFetchOnce(response: {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
}) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: response.json ?? (() => Promise.resolve({})),
  });
}

describe("api client", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  describe("request() internals via api.getRuns (GET, no body)", () => {
    it("performs a successful GET request and resolves with parsed JSON", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ runs: [{ id: "1" }] }) });

      const result = await api.getRuns();

      expect(result).toEqual({ runs: [{ id: "1" }] });
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs", {
        headers: {},
      });
    });

    it("does not set Content-Type header when there is no body", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ runs: [] }) });

      await api.getRuns();

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(init.headers).toEqual({});
      expect(init.headers["Content-Type"]).toBeUndefined();
    });

    it("appends the state query param when provided", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ runs: [] }) });

      await api.getRuns("Planning");

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs?state=Planning", {
        headers: {},
      });
    });
  });

  describe("request() internals via api.approvePlan (POST, with body)", () => {
    it("performs a successful POST request and sets Content-Type header", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "Implementing" }) });

      const result = await api.approvePlan("run-1", "looks good");

      expect(result).toEqual({ ok: true, state: "Implementing" });
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "looks good" }),
      });
    });

    it("omits the note (sends undefined) when no note is passed", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "Implementing" }) });

      await api.approvePlan("run-1");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({});
    });
  });

  describe("error handling", () => {
    it("throws an Error using the parsed JSON body's .error field when response is not ok", async () => {
      mockFetchOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Invalid request" }),
      });

      await expect(api.getRuns()).rejects.toThrow("Invalid request");
    });

    it("throws an Error with 'HTTP <status>' when the error body has no .error field", async () => {
      mockFetchOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      });

      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });

    it("throws an Error with 'HTTP <status>' when the error body fails to parse as JSON", async () => {
      mockFetchOnce({
        ok: false,
        status: 502,
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
      });

      await expect(api.getRuns()).rejects.toThrow("HTTP 502");
    });
  });

  describe("additional api.* methods", () => {
    it("getRun() fetches the single-run endpoint via GET", async () => {
      mockFetchOnce({
        ok: true,
        json: () => Promise.resolve({ run: { id: "run-1" }, artifacts: [], events: [] }),
      });

      const result = await api.getRun("run-1");

      expect(result).toEqual({ run: { id: "run-1" }, artifacts: [], events: [] });
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1", { headers: {} });
    });

    it("sendChatMessage() posts the message body to the chat endpoint", async () => {
      mockFetchOnce({
        ok: true,
        json: () => Promise.resolve({ reply: "hi there", durationMs: 42 }),
      });

      const result = await api.sendChatMessage("run-1", "hello");

      expect(result).toEqual({ reply: "hi there", durationMs: 42 });
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      });
    });

    it("getActiveProcesses() omits the runId query param when not provided", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ processes: [] }) });

      await api.getActiveProcesses();

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
    });

    it("getActiveProcesses() includes the runId query param when provided", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ processes: [] }) });

      await api.getActiveProcesses("run-9");

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes?runId=run-9", { headers: {} });
    });

    it("ingestIssues() posts the issueIds array", async () => {
      mockFetchOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, started: ["a"], skipped: [] }),
      });

      const result = await api.ingestIssues(["a"]);

      expect(result).toEqual({ ok: true, started: ["a"], skipped: [] });
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/linear/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueIds: ["a"] }),
      });
    });

    it("getRunSkills() fetches the run skills endpoint via GET", async () => {
      mockFetchOnce({
        ok: true,
        json: () =>
          Promise.resolve({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
      });

      await api.getRunSkills("run-1");

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/skills", { headers: {} });
    });

    it("getArtifacts() fetches the artifacts endpoint via GET", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ artifacts: [] }) });

      await api.getArtifacts("run-1");

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/artifacts", { headers: {} });
    });

    it("getEvents() fetches the events endpoint via GET", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ events: [] }) });

      await api.getEvents("run-1");

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/events", { headers: {} });
    });

    it("rejectPlan() posts context and mode, defaulting mode to 'iterate'", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "PlanRevision" }) });

      await api.rejectPlan("run-1", "needs work");

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/reject-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: "needs work", mode: "iterate" }),
      });
    });

    it("rejectPlan() passes an explicit mode through", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "PlanRevision" }) });

      await api.rejectPlan("run-1", undefined, "fresh");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ context: undefined, mode: "fresh" });
    });

    it("reReviewPlan() posts an optional note to the re-review endpoint", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) });

      await api.reReviewPlan("run-1", "note text");

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/re-review-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "note text" }),
      });
    });

    it("reReviewPlan() omits the note when none is passed", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) });

      await api.reReviewPlan("run-1");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({});
    });

    it("revisePlan() posts an optional note to the revise endpoint", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) });

      await api.revisePlan("run-1");

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/revise-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: undefined }),
      });
    });

    it("approveReview() posts to the approve-review endpoint with no body", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "Implementing" }) });

      await api.approveReview("run-1");

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-review", {
        method: "POST",
        headers: {},
      });
    });

    it("pauseRun() posts to the pause endpoint", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

      await api.pauseRun("run-1");

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/pause", {
        method: "POST",
        headers: {},
      });
    });

    it("resumeRun() posts to the resume endpoint", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

      await api.resumeRun("run-1");

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/resume", {
        method: "POST",
        headers: {},
      });
    });

    it("retryStage() posts to the retry endpoint", async () => {
      mockFetchOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, state: "Implementing", retrying: true }),
      });

      const result = await api.retryStage("run-1");

      expect(result).toEqual({ ok: true, state: "Implementing", retrying: true });
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/retry", {
        method: "POST",
        headers: {},
      });
    });

    it("getProcessOutput() fetches the process output endpoint via GET", async () => {
      mockFetchOnce({
        ok: true,
        json: () => Promise.resolve({ processId: "proc-1", output: "logs..." }),
      });

      const result = await api.getProcessOutput("proc-1");

      expect(result).toEqual({ processId: "proc-1", output: "logs..." });
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes/proc-1/output", { headers: {} });
    });

    it("fetchPendingIssues() fetches the pending linear issues endpoint via GET", async () => {
      mockFetchOnce({ ok: true, json: () => Promise.resolve({ issues: [] }) });

      const result = await api.fetchPendingIssues();

      expect(result).toEqual({ issues: [] });
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
    });

    it("answerQuestions() posts the answers array", async () => {
      mockFetchOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, run: { id: "run-1" } }),
      });

      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("run-1", answers);

      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/answer-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
    });
  });
});
