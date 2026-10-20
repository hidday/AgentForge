import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

interface MockResponse {
  ok: boolean;
  status: number;
  json: ReturnType<typeof vi.fn>;
}

function okResponse(data: unknown, status = 200): MockResponse {
  return { ok: true, status, json: vi.fn().mockResolvedValue(data) };
}

function errorResponse(status: number, body: unknown): MockResponse {
  return { ok: false, status, json: vi.fn().mockResolvedValue(body) };
}

function errorResponseBadJson(status: number): MockResponse {
  return {
    ok: false,
    status,
    json: vi.fn().mockRejectedValue(new Error("not json")),
  };
}

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function lastCall() {
    const calls = fetchMock.mock.calls;
    return calls[calls.length - 1] as [string, RequestInit];
  }

  describe("GET requests without a body", () => {
    it("getRuns without a state omits the query string and sends no Content-Type", async () => {
      fetchMock.mockResolvedValue(okResponse({ runs: [] }));
      const result = await api.getRuns();
      const [url, options] = lastCall();
      expect(url).toBe("/api/runs");
      expect(options.headers).toEqual({});
      expect(result).toEqual({ runs: [] });
    });

    it("getRuns with a state appends ?state=", async () => {
      fetchMock.mockResolvedValue(okResponse({ runs: [] }));
      await api.getRuns("Running");
      const [url] = lastCall();
      expect(url).toBe("/api/runs?state=Running");
    });

    it("getRun builds /runs/:id and resolves parsed JSON", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      fetchMock.mockResolvedValue(okResponse(payload));
      const result = await api.getRun("r1");
      const [url] = lastCall();
      expect(url).toBe("/api/runs/r1");
      expect(result).toEqual(payload);
    });

    it("getRunSkills builds /runs/:runId/skills", async () => {
      fetchMock.mockResolvedValue(
        okResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
      );
      await api.getRunSkills("r1");
      const [url] = lastCall();
      expect(url).toBe("/api/runs/r1/skills");
    });

    it("getArtifacts builds /runs/:runId/artifacts", async () => {
      fetchMock.mockResolvedValue(okResponse({ artifacts: [] }));
      await api.getArtifacts("r1");
      const [url] = lastCall();
      expect(url).toBe("/api/runs/r1/artifacts");
    });

    it("getEvents builds /runs/:runId/events", async () => {
      fetchMock.mockResolvedValue(okResponse({ events: [] }));
      await api.getEvents("r1");
      const [url] = lastCall();
      expect(url).toBe("/api/runs/r1/events");
    });

    it("getProcessOutput builds /processes/:processId/output", async () => {
      fetchMock.mockResolvedValue(okResponse({ processId: "p1", output: "hi" }));
      const result = await api.getProcessOutput("p1");
      const [url] = lastCall();
      expect(url).toBe("/api/processes/p1/output");
      expect(result).toEqual({ processId: "p1", output: "hi" });
    });

    it("fetchPendingIssues builds /linear/pending", async () => {
      fetchMock.mockResolvedValue(okResponse({ issues: [] }));
      await api.fetchPendingIssues();
      const [url] = lastCall();
      expect(url).toBe("/api/linear/pending");
    });

    it("getActiveProcesses without runId omits the query string", async () => {
      fetchMock.mockResolvedValue(okResponse({ processes: [] }));
      await api.getActiveProcesses();
      const [url] = lastCall();
      expect(url).toBe("/api/processes");
    });

    it("getActiveProcesses with runId appends ?runId=", async () => {
      fetchMock.mockResolvedValue(okResponse({ processes: [] }));
      await api.getActiveProcesses("r1");
      const [url] = lastCall();
      expect(url).toBe("/api/processes?runId=r1");
    });
  });

  describe("POST requests with a body", () => {
    it("approvePlan sends a note and a Content-Type header", async () => {
      fetchMock.mockResolvedValue(okResponse({ ok: true, state: "Executing" }));
      await api.approvePlan("r1", "go ahead");
      const [url, options] = lastCall();
      expect(url).toBe("/api/runs/r1/actions/approve-plan");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({ "Content-Type": "application/json" });
      expect(options.body).toBe(JSON.stringify({ note: "go ahead" }));
    });

    it("approvePlan omits the note field when not provided", async () => {
      fetchMock.mockResolvedValue(okResponse({ ok: true, state: "Executing" }));
      await api.approvePlan("r1");
      const [, options] = lastCall();
      expect(options.body).toBe(JSON.stringify({ note: undefined }));
      expect(options.body).toBe("{}");
    });

    it("rejectPlan sends context and an explicit mode", async () => {
      fetchMock.mockResolvedValue(okResponse({ ok: true, state: "Planning" }));
      await api.rejectPlan("r1", "needs work", "fresh");
      const [url, options] = lastCall();
      expect(url).toBe("/api/runs/r1/actions/reject-plan");
      expect(options.body).toBe(JSON.stringify({ context: "needs work", mode: "fresh" }));
    });

    it("rejectPlan defaults mode to 'iterate' and drops empty context", async () => {
      fetchMock.mockResolvedValue(okResponse({ ok: true, state: "Planning" }));
      await api.rejectPlan("r1");
      const [, options] = lastCall();
      expect(options.body).toBe(JSON.stringify({ context: undefined, mode: "iterate" }));
    });

    it("reReviewPlan posts a note to /actions/re-review-plan", async () => {
      fetchMock.mockResolvedValue(okResponse({ ok: true, runId: "r1" }));
      await api.reReviewPlan("r1", "please re-review");
      const [url, options] = lastCall();
      expect(url).toBe("/api/runs/r1/actions/re-review-plan");
      expect(options.body).toBe(JSON.stringify({ note: "please re-review" }));
    });

    it("reReviewPlan drops the note field when no note is given", async () => {
      fetchMock.mockResolvedValue(okResponse({ ok: true, runId: "r1" }));
      await api.reReviewPlan("r1");
      const [, options] = lastCall();
      expect(options.body).toBe(JSON.stringify({ note: undefined }));
    });

    it("revisePlan posts a note to /actions/revise-plan", async () => {
      fetchMock.mockResolvedValue(okResponse({ ok: true, runId: "r1" }));
      await api.revisePlan("r1", "revise this");
      const [url, options] = lastCall();
      expect(url).toBe("/api/runs/r1/actions/revise-plan");
      expect(options.body).toBe(JSON.stringify({ note: "revise this" }));
    });

    it("revisePlan drops the note field when no note is given", async () => {
      fetchMock.mockResolvedValue(okResponse({ ok: true, runId: "r1" }));
      await api.revisePlan("r1");
      const [, options] = lastCall();
      expect(options.body).toBe(JSON.stringify({ note: undefined }));
    });

    it("ingestIssues posts the issueIds array", async () => {
      fetchMock.mockResolvedValue(okResponse({ ok: true, started: ["a"], skipped: [] }));
      await api.ingestIssues(["a", "b"]);
      const [url, options] = lastCall();
      expect(url).toBe("/api/linear/ingest");
      expect(options.body).toBe(JSON.stringify({ issueIds: ["a", "b"] }));
    });

    it("answerQuestions posts the answers array", async () => {
      fetchMock.mockResolvedValue(okResponse({ ok: true, run: {} }));
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("r1", answers);
      const [url, options] = lastCall();
      expect(url).toBe("/api/runs/r1/actions/answer-questions");
      expect(options.body).toBe(JSON.stringify({ answers }));
    });

    it("sendChatMessage posts the message", async () => {
      fetchMock.mockResolvedValue(okResponse({ reply: "hi", durationMs: 10 }));
      await api.sendChatMessage("r1", "hello agent");
      const [url, options] = lastCall();
      expect(url).toBe("/api/runs/r1/chat");
      expect(options.body).toBe(JSON.stringify({ message: "hello agent" }));
    });
  });

  describe("POST requests without a body", () => {
    it("approveReview posts with no Content-Type header and no body", async () => {
      fetchMock.mockResolvedValue(okResponse({ ok: true, state: "Done" }));
      await api.approveReview("r1");
      const [url, options] = lastCall();
      expect(url).toBe("/api/runs/r1/actions/approve-review");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({});
      expect(options.body).toBeUndefined();
    });

    it("pauseRun posts to /actions/pause", async () => {
      fetchMock.mockResolvedValue(okResponse({ ok: true }));
      await api.pauseRun("r1");
      const [url, options] = lastCall();
      expect(url).toBe("/api/runs/r1/actions/pause");
      expect(options.method).toBe("POST");
    });

    it("resumeRun posts to /actions/resume", async () => {
      fetchMock.mockResolvedValue(okResponse({ ok: true }));
      await api.resumeRun("r1");
      const [url, options] = lastCall();
      expect(url).toBe("/api/runs/r1/actions/resume");
      expect(options.method).toBe("POST");
    });

    it("retryStage posts to /actions/retry", async () => {
      fetchMock.mockResolvedValue(okResponse({ ok: true, state: "Executing", retrying: true }));
      const result = await api.retryStage("r1");
      const [url, options] = lastCall();
      expect(url).toBe("/api/runs/r1/actions/retry");
      expect(options.method).toBe("POST");
      expect(result).toEqual({ ok: true, state: "Executing", retrying: true });
    });
  });

  describe("error handling", () => {
    it("throws the error message from the response body when present", async () => {
      fetchMock.mockResolvedValue(errorResponse(400, { error: "Bad input" }));
      await expect(api.getRun("r1")).rejects.toThrow("Bad input");
    });

    it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
      fetchMock.mockResolvedValue(errorResponse(500, {}));
      await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error body cannot be parsed as JSON", async () => {
      fetchMock.mockResolvedValue(errorResponseBadJson(503));
      await expect(api.getRun("r1")).rejects.toThrow("HTTP 503");
    });

    it("rejects with the underlying network error when fetch itself rejects", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      await expect(api.getRuns()).rejects.toThrow("network down");
    });
  });
});
