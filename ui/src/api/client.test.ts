import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function mockFetchOnce(body: unknown, init?: { ok?: boolean; status?: number }) {
  const ok = init?.ok ?? true;
  const status = init?.status ?? (ok ? 200 : 500);
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("request() success path", () => {
    it("resolves with parsed JSON when response is ok", async () => {
      const fetchMock = mockFetchOnce({ runs: [] });
      vi.stubGlobal("fetch", fetchMock);

      const result = await api.getRuns();
      expect(result).toEqual({ runs: [] });
      expect(fetchMock).toHaveBeenCalledWith("/api/runs", { headers: {} });
    });

    it("appends the state query param when provided", async () => {
      const fetchMock = mockFetchOnce({ runs: [] });
      vi.stubGlobal("fetch", fetchMock);

      await api.getRuns("Planning");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs?state=Planning", { headers: {} });
    });

    it("does not set Content-Type header for GET requests without a body", async () => {
      const fetchMock = mockFetchOnce({ processes: [] });
      vi.stubGlobal("fetch", fetchMock);

      await api.getActiveProcesses();
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(options.headers).toEqual({});
    });

    it("appends runId query param for getActiveProcesses when provided", async () => {
      const fetchMock = mockFetchOnce({ processes: [] });
      vi.stubGlobal("fetch", fetchMock);

      await api.getActiveProcesses("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=run-1", { headers: {} });
    });

    it("sets Content-Type: application/json header when a body is present", async () => {
      const fetchMock = mockFetchOnce({ ok: true, state: "Implementing" });
      vi.stubGlobal("fetch", fetchMock);

      await api.approvePlan("run-1", "note text");
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/runs/run-1/actions/approve-plan");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({ "Content-Type": "application/json" });
      expect(options.body).toBe(JSON.stringify({ note: "note text" }));
    });

    it("omits the note field (sends undefined) when approvePlan is called without a note", async () => {
      const fetchMock = mockFetchOnce({ ok: true, state: "Implementing" });
      vi.stubGlobal("fetch", fetchMock);

      await api.approvePlan("run-1");
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(options.body as string)).toEqual({});
    });
  });

  describe("request() error path", () => {
    it("throws an Error using the server-provided error message on non-ok response", async () => {
      const fetchMock = mockFetchOnce({ error: "Run not found" }, { ok: false, status: 404 });
      vi.stubGlobal("fetch", fetchMock);

      await expect(api.getRun("missing-id")).rejects.toThrow("Run not found");
    });

    it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
      const fetchMock = mockFetchOnce({}, { ok: false, status: 500 });
      vi.stubGlobal("fetch", fetchMock);

      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error body cannot be parsed as JSON", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error("invalid json")),
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 502");
    });
  });

  describe("endpoint coverage", () => {
    it("getRun requests the run detail endpoint", async () => {
      const fetchMock = mockFetchOnce({ run: {}, artifacts: [], events: [] });
      vi.stubGlobal("fetch", fetchMock);
      await api.getRun("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1", { headers: {} });
    });

    it("getRunSkills requests the skills endpoint", async () => {
      const fetchMock = mockFetchOnce({ injectedSkills: [], distillationDecision: null, distilledSkill: null });
      vi.stubGlobal("fetch", fetchMock);
      await api.getRunSkills("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/skills", { headers: {} });
    });

    it("getArtifacts requests the artifacts endpoint", async () => {
      const fetchMock = mockFetchOnce({ artifacts: [] });
      vi.stubGlobal("fetch", fetchMock);
      await api.getArtifacts("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/artifacts", { headers: {} });
    });

    it("getEvents requests the events endpoint", async () => {
      const fetchMock = mockFetchOnce({ events: [] });
      vi.stubGlobal("fetch", fetchMock);
      await api.getEvents("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/events", { headers: {} });
    });

    it("rejectPlan sends context and defaults mode to 'iterate'", async () => {
      const fetchMock = mockFetchOnce({ ok: true, state: "Planning" });
      vi.stubGlobal("fetch", fetchMock);
      await api.rejectPlan("run-1", "please redo step 2");
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/runs/run-1/actions/reject-plan");
      expect(JSON.parse(options.body as string)).toEqual({
        context: "please redo step 2",
        mode: "iterate",
      });
    });

    it("rejectPlan forwards an explicit 'fresh' mode", async () => {
      const fetchMock = mockFetchOnce({ ok: true, state: "Planning" });
      vi.stubGlobal("fetch", fetchMock);
      await api.rejectPlan("run-1", undefined, "fresh");
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(options.body as string)).toEqual({ context: undefined, mode: "fresh" });
    });

    it("reReviewPlan posts to the re-review-plan endpoint", async () => {
      const fetchMock = mockFetchOnce({ ok: true, runId: "run-1" });
      vi.stubGlobal("fetch", fetchMock);
      await api.reReviewPlan("run-1", "focus on tests");
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/runs/run-1/actions/re-review-plan");
      expect(JSON.parse(options.body as string)).toEqual({ note: "focus on tests" });
    });

    it("reReviewPlan omits the note field when called without one", async () => {
      const fetchMock = mockFetchOnce({ ok: true, runId: "run-1" });
      vi.stubGlobal("fetch", fetchMock);
      await api.reReviewPlan("run-1");
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(options.body as string)).toEqual({});
    });

    it("revisePlan posts to the revise-plan endpoint", async () => {
      const fetchMock = mockFetchOnce({ ok: true, runId: "run-1" });
      vi.stubGlobal("fetch", fetchMock);
      await api.revisePlan("run-1");
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/runs/run-1/actions/revise-plan");
    });

    it("approveReview posts with no body", async () => {
      const fetchMock = mockFetchOnce({ ok: true, state: "Done" });
      vi.stubGlobal("fetch", fetchMock);
      await api.approveReview("run-1");
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/runs/run-1/actions/approve-review");
      expect(options.method).toBe("POST");
      expect(options.body).toBeUndefined();
    });

    it("pauseRun posts to the pause endpoint", async () => {
      const fetchMock = mockFetchOnce({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
      await api.pauseRun("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/pause", { method: "POST", headers: {} });
    });

    it("resumeRun posts to the resume endpoint", async () => {
      const fetchMock = mockFetchOnce({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
      await api.resumeRun("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/resume", { method: "POST", headers: {} });
    });

    it("retryStage posts to the retry endpoint", async () => {
      const fetchMock = mockFetchOnce({ ok: true, state: "Implementing", retrying: true });
      vi.stubGlobal("fetch", fetchMock);
      await api.retryStage("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/retry", { method: "POST", headers: {} });
    });

    it("getProcessOutput requests the process output endpoint", async () => {
      const fetchMock = mockFetchOnce({ processId: "p1", output: "hello" });
      vi.stubGlobal("fetch", fetchMock);
      await api.getProcessOutput("p1");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
    });

    it("fetchPendingIssues requests the linear pending endpoint", async () => {
      const fetchMock = mockFetchOnce({ issues: [] });
      vi.stubGlobal("fetch", fetchMock);
      await api.fetchPendingIssues();
      expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
    });

    it("ingestIssues posts the issueIds array", async () => {
      const fetchMock = mockFetchOnce({ ok: true, started: ["a"], skipped: [] });
      vi.stubGlobal("fetch", fetchMock);
      await api.ingestIssues(["a", "b"]);
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/linear/ingest");
      expect(JSON.parse(options.body as string)).toEqual({ issueIds: ["a", "b"] });
    });

    it("answerQuestions posts the answers array", async () => {
      const fetchMock = mockFetchOnce({ ok: true, run: {} });
      vi.stubGlobal("fetch", fetchMock);
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("run-1", answers);
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/runs/run-1/actions/answer-questions");
      expect(JSON.parse(options.body as string)).toEqual({ answers });
    });

    it("sendChatMessage posts the message", async () => {
      const fetchMock = mockFetchOnce({ reply: "hi", durationMs: 10 });
      vi.stubGlobal("fetch", fetchMock);
      await api.sendChatMessage("run-1", "hello there");
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/runs/run-1/chat");
      expect(JSON.parse(options.body as string)).toEqual({ message: "hello there" });
    });
  });
});
