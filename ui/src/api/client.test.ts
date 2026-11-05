import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  describe("request() success path", () => {
    it("getRuns (no filter) returns parsed JSON and omits query string / Content-Type header", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [{ id: "r1" }] }));

      const result = await api.getRuns();

      expect(result).toEqual({ runs: [{ id: "r1" }] });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs");
      expect(init.headers).toEqual({});
    });

    it("getRuns (with state filter) appends the query param", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));

      await api.getRuns("in_progress");

      const [url] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs?state=in_progress");
    });

    it("getActiveProcesses (no runId) omits the query string", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));

      await api.getActiveProcesses();

      const [url] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/processes");
    });

    it("getActiveProcesses (with runId) appends the runId filter", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));

      await api.getActiveProcesses("run-42");

      const [url] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/processes?runId=run-42");
    });

    it("getRun fetches the per-run detail endpoint", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      fetchMock.mockResolvedValue(jsonResponse(payload));

      const result = await api.getRun("r1");

      expect(result).toEqual(payload);
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r1");
    });

    it("POST approvePlan sends method, URL and JSON body; sets Content-Type", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "approved" }));

      const result = await api.approvePlan("run-1", "looks good");

      expect(result).toEqual({ ok: true, state: "approved" });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/approve-plan");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(init.body)).toEqual({ note: "looks good" });
    });

    it("approvePlan omits the note when not provided (undefined, not empty string)", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "approved" }));

      await api.approvePlan("run-1");

      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init.body)).toEqual({ note: undefined });
    });

    it("rejectPlan defaults mode to 'iterate' when not provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "rejected" }));

      await api.rejectPlan("run-1");

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/reject-plan");
      expect(JSON.parse(init.body)).toEqual({ context: undefined, mode: "iterate" });
    });

    it("rejectPlan passes through an explicit mode and context", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "rejected" }));

      await api.rejectPlan("run-1", "needs rework", "fresh");

      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init.body)).toEqual({ context: "needs rework", mode: "fresh" });
    });

    it("approveReview POSTs with no body and still sets no Content-Type header", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "reviewed" }));

      await api.approveReview("run-1");

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/approve-review");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({});
      expect(init.body).toBeUndefined();
    });

    it("pauseRun / resumeRun / retryStage call the right endpoints", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.pauseRun("run-1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/run-1/actions/pause");

      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.resumeRun("run-1");
      expect(fetchMock.mock.calls[1]![0]).toBe("/api/runs/run-1/actions/resume");

      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "running", retrying: true }));
      await api.retryStage("run-1");
      expect(fetchMock.mock.calls[2]![0]).toBe("/api/runs/run-1/actions/retry");
    });

    it("ingestIssues POSTs the issueIds array as the body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: ["a"], skipped: [] }));

      await api.ingestIssues(["a", "b"]);

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/linear/ingest");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ issueIds: ["a", "b"] });
    });

    it("fetchPendingIssues calls the pending Linear issues endpoint (GET, no body)", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));

      await api.fetchPendingIssues();

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/linear/pending");
      expect(init.headers).toEqual({});
    });

    it("answerQuestions POSTs the answers array", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, run: { id: "run-1" } }));

      await api.answerQuestions("run-1", [{ questionId: "q1", answer: "42" }]);

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/answer-questions");
      expect(JSON.parse(init.body)).toEqual({ answers: [{ questionId: "q1", answer: "42" }] });
    });

    it("sendChatMessage POSTs the message to the chat endpoint", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ reply: "hi", durationMs: 12 }));

      const result = await api.sendChatMessage("run-1", "hello");

      expect(result).toEqual({ reply: "hi", durationMs: 12 });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/chat");
      expect(JSON.parse(init.body)).toEqual({ message: "hello" });
    });

    it("getRunSkills, getArtifacts, getEvents, getProcessOutput hit their respective endpoints", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      await api.getRunSkills("run-1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/run-1/skills");

      fetchMock.mockResolvedValue(jsonResponse({}));
      await api.getArtifacts("run-1");
      expect(fetchMock.mock.calls[1]![0]).toBe("/api/runs/run-1/artifacts");

      fetchMock.mockResolvedValue(jsonResponse({}));
      await api.getEvents("run-1");
      expect(fetchMock.mock.calls[2]![0]).toBe("/api/runs/run-1/events");

      fetchMock.mockResolvedValue(jsonResponse({}));
      await api.getProcessOutput("proc-1");
      expect(fetchMock.mock.calls[3]![0]).toBe("/api/processes/proc-1/output");
    });

    it("reReviewPlan and revisePlan POST to their respective action endpoints", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.reReviewPlan("run-1", "note");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/run-1/actions/re-review-plan");
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ note: "note" });

      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.revisePlan("run-1");
      expect(fetchMock.mock.calls[1]![0]).toBe("/api/runs/run-1/actions/revise-plan");
      expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ note: undefined });
    });

    it("reReviewPlan omits the note when not provided (falsy note branch)", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.reReviewPlan("run-1");
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ note: undefined });
    });
  });

  describe("request() error path", () => {
    it("throws an Error using the response body's .error field when !res.ok", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "Run not found" }, false, 404));

      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to 'HTTP {status}' when res.json() rejects while handling a non-ok response", async () => {
      const res = {
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error("not json")),
      } as unknown as Response;
      fetchMock.mockResolvedValue(res);

      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP {status}' when the error body has no .error field", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: "nope" }, false, 400));

      await expect(api.getRuns()).rejects.toThrow("HTTP 400");
    });

    it("propagates network failures (fetch itself rejecting)", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));

      await expect(api.getRuns()).rejects.toThrow("network down");
    });
  });
});
