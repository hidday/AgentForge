import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  describe("request() success/error/header behavior", () => {
    it("performs a GET with no Content-Type header when there is no body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs");
      expect(opts.headers).toEqual({});
      expect(opts.method).toBeUndefined();
    });

    it("sets Content-Type: application/json and passes JSON body when a body is provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Planning" }));
      await api.approvePlan("run-1", "looks good");

      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/approve-plan");
      expect(opts.method).toBe("POST");
      expect(opts.headers).toEqual({ "Content-Type": "application/json" });
      expect(opts.body).toBe(JSON.stringify({ note: "looks good" }));
    });

    it("resolves with the parsed JSON body on a successful response", async () => {
      const payload = { runs: [{ id: "r1" }] };
      fetchMock.mockResolvedValue(jsonResponse(payload));
      const result = await api.getRuns();
      expect(result).toEqual(payload);
    });

    it("throws using the server-provided error message when the response is not ok", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "Run not found" }, false, 404));
      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to an 'HTTP <status>' message when the error body has no error field", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to an 'HTTP <status>' message when the error body fails to parse as JSON", async () => {
      const res = {
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error("not json")),
      } as unknown as Response;
      fetchMock.mockResolvedValue(res);
      await expect(api.getRun("r1")).rejects.toThrow("HTTP 502");
    });
  });

  describe("endpoint URL/method/body construction", () => {
    it("getRuns() with no filter hits /runs with no query string", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns();
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs");
    });

    it("getRuns(state) appends a state query param", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns("Planning");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs?state=Planning");
    });

    it("getRun(id) hits /runs/:id", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ run: {}, artifacts: [], events: [] }));
      await api.getRun("run-42");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/run-42");
    });

    it("getRunSkills(runId) hits /runs/:runId/skills", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
      );
      await api.getRunSkills("run-1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/run-1/skills");
    });

    it("getArtifacts(runId) hits /runs/:runId/artifacts", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ artifacts: [] }));
      await api.getArtifacts("run-1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/run-1/artifacts");
    });

    it("getEvents(runId) hits /runs/:runId/events", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ events: [] }));
      await api.getEvents("run-1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/run-1/events");
    });

    it("approvePlan(runId) omits note when not provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.approvePlan("run-1");
      const [, opts] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(opts.body)).toEqual({ note: undefined });
    });

    it("rejectPlan(runId) defaults mode to 'iterate' and omits context when absent", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.rejectPlan("run-1");
      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/reject-plan");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({ context: undefined, mode: "iterate" });
    });

    it("rejectPlan(runId, context, mode) forwards explicit context and mode", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.rejectPlan("run-1", "needs work", "fresh");
      const [, opts] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(opts.body)).toEqual({ context: "needs work", mode: "fresh" });
    });

    it("reReviewPlan(runId, note) posts to actions/re-review-plan", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.reReviewPlan("run-1", "note text");
      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/re-review-plan");
      expect(JSON.parse(opts.body)).toEqual({ note: "note text" });
    });

    it("revisePlan(runId, note) posts to actions/revise-plan", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.revisePlan("run-1");
      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/revise-plan");
      expect(JSON.parse(opts.body)).toEqual({ note: undefined });
    });

    it("approveReview(runId) POSTs with no body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.approveReview("run-1");
      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/approve-review");
      expect(opts.method).toBe("POST");
      expect(opts.body).toBeUndefined();
      expect(opts.headers).toEqual({});
    });

    it("pauseRun(runId) POSTs to actions/pause", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.pauseRun("run-1");
      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/pause");
      expect(opts.method).toBe("POST");
    });

    it("resumeRun(runId) POSTs to actions/resume", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.resumeRun("run-1");
      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/resume");
      expect(opts.method).toBe("POST");
    });

    it("retryStage(runId) POSTs to actions/retry", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x", retrying: true }));
      await api.retryStage("run-1");
      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/retry");
      expect(opts.method).toBe("POST");
    });

    it("getActiveProcesses() with no runId omits the query string", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses();
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes");
    });

    it("getActiveProcesses(runId) appends a runId query param", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses("run-9");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes?runId=run-9");
    });

    it("getProcessOutput(processId) hits /processes/:id/output", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processId: "p1", output: "log" }));
      await api.getProcessOutput("p1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes/p1/output");
    });

    it("fetchPendingIssues() hits /linear/pending", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));
      await api.fetchPendingIssues();
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/linear/pending");
    });

    it("ingestIssues(issueIds) POSTs the ids array to /linear/ingest", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: [], skipped: [] }));
      await api.ingestIssues(["a", "b"]);
      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/linear/ingest");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({ issueIds: ["a", "b"] });
    });

    it("answerQuestions(runId, answers) posts answers array", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, run: {} }));
      const answers = [{ questionId: "q1", answer: "42" }];
      await api.answerQuestions("run-1", answers);
      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/answer-questions");
      expect(JSON.parse(opts.body)).toEqual({ answers });
    });

    it("sendChatMessage(runId, message) posts to chat endpoint", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ reply: "hi", durationMs: 5 }));
      await api.sendChatMessage("run-1", "hello there");
      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/chat");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({ message: "hello there" });
    });
  });
});
