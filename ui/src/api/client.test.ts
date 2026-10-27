import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
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

  // -------------------------------------------------------------------------
  // GET requests / URL construction
  // -------------------------------------------------------------------------
  describe("GET requests", () => {
    it("getRuns() with no filter calls /api/runs with no query string and GET-shaped headers", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      const result = await api.getRuns();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs");
      // No body => no Content-Type header should be set
      expect(init.headers).toEqual({});
      expect(result).toEqual({ runs: [] });
    });

    it("getRuns(state) appends the state as a query parameter", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns("Planning");

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs?state=Planning");
    });

    it("getRun(id) requests /api/runs/:id and returns the parsed payload", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      fetchMock.mockResolvedValue(jsonResponse(payload));
      const result = await api.getRun("r1");

      expect(fetchMock.mock.calls[0][0]).toBe("/api/runs/r1");
      expect(result).toEqual(payload);
    });

    it("getRunSkills(runId) requests /api/runs/:id/skills", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
      );
      await api.getRunSkills("r1");
      expect(fetchMock.mock.calls[0][0]).toBe("/api/runs/r1/skills");
    });

    it("getArtifacts(runId) requests /api/runs/:id/artifacts", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ artifacts: [] }));
      await api.getArtifacts("r1");
      expect(fetchMock.mock.calls[0][0]).toBe("/api/runs/r1/artifacts");
    });

    it("getEvents(runId) requests /api/runs/:id/events", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ events: [] }));
      await api.getEvents("r1");
      expect(fetchMock.mock.calls[0][0]).toBe("/api/runs/r1/events");
    });

    it("getActiveProcesses() with no runId omits the query string", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses();
      expect(fetchMock.mock.calls[0][0]).toBe("/api/processes");
    });

    it("getActiveProcesses(runId) includes the runId query parameter", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses("r1");
      expect(fetchMock.mock.calls[0][0]).toBe("/api/processes?runId=r1");
    });

    it("getProcessOutput(processId) requests /api/processes/:id/output", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processId: "p1", output: "hello" }));
      const result = await api.getProcessOutput("p1");
      expect(fetchMock.mock.calls[0][0]).toBe("/api/processes/p1/output");
      expect(result).toEqual({ processId: "p1", output: "hello" });
    });

    it("fetchPendingIssues() requests /api/linear/pending", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));
      await api.fetchPendingIssues();
      expect(fetchMock.mock.calls[0][0]).toBe("/api/linear/pending");
    });
  });

  // -------------------------------------------------------------------------
  // POST requests / body + header construction
  // -------------------------------------------------------------------------
  describe("POST requests", () => {
    it("approvePlan(runId, note) POSTs with Content-Type header and JSON body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
      await api.approvePlan("r1", "looks good");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/r1/actions/approve-plan");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(init.body)).toEqual({ note: "looks good" });
    });

    it("approvePlan(runId) without a note sends note: undefined (omitted when serialized)", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
      await api.approvePlan("r1");

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({});
    });

    it("rejectPlan defaults mode to 'iterate' when not provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));
      await api.rejectPlan("r1", "needs work");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/r1/actions/reject-plan");
      expect(JSON.parse(init.body)).toEqual({ context: "needs work", mode: "iterate" });
    });

    it("rejectPlan passes through an explicit mode", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Planning" }));
      await api.rejectPlan("r1", "restart", "fresh");

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ context: "restart", mode: "fresh" });
    });

    it("reReviewPlan(runId, note) POSTs to the re-review-plan action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      await api.reReviewPlan("r1", "note");
      expect(fetchMock.mock.calls[0][0]).toBe("/api/runs/r1/actions/re-review-plan");
    });

    it("revisePlan(runId, note) POSTs to the revise-plan action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      await api.revisePlan("r1", "note");
      expect(fetchMock.mock.calls[0][0]).toBe("/api/runs/r1/actions/revise-plan");
    });

    it("approveReview(runId) POSTs with no body (no Content-Type header)", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
      await api.approveReview("r1");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/r1/actions/approve-review");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({});
      expect(init.body).toBeUndefined();
    });

    it("pauseRun(runId) POSTs to the pause action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.pauseRun("r1");
      expect(fetchMock.mock.calls[0][0]).toBe("/api/runs/r1/actions/pause");
      expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    });

    it("resumeRun(runId) POSTs to the resume action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.resumeRun("r1");
      expect(fetchMock.mock.calls[0][0]).toBe("/api/runs/r1/actions/resume");
    });

    it("retryStage(runId) POSTs to the retry action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing", retrying: true }));
      await api.retryStage("r1");
      expect(fetchMock.mock.calls[0][0]).toBe("/api/runs/r1/actions/retry");
    });

    it("ingestIssues(issueIds) POSTs the issueIds array as the body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: ["a"], skipped: [] }));
      await api.ingestIssues(["a", "b"]);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/linear/ingest");
      expect(JSON.parse(init.body)).toEqual({ issueIds: ["a", "b"] });
    });

    it("answerQuestions(runId, answers) POSTs the answers array", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, run: {} }));
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("r1", answers);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/r1/actions/answer-questions");
      expect(JSON.parse(init.body)).toEqual({ answers });
    });

    it("sendChatMessage(runId, message) POSTs to the chat endpoint", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ reply: "hi", durationMs: 10 }));
      const result = await api.sendChatMessage("r1", "hello agent");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/r1/chat");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ message: "hello agent" });
      expect(result).toEqual({ reply: "hi", durationMs: 10 });
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------
  describe("error handling", () => {
    it("throws the server-provided error message on a non-2xx JSON response", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "Run not found" }, false, 404));

      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to 'HTTP <status>' when the error body has no 'error' field", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message: "nope" }, false, 500));

      await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error body fails to parse as JSON", async () => {
      const res = {
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("not json")),
      } as unknown as Response;
      fetchMock.mockResolvedValue(res);

      await expect(api.getRun("r1")).rejects.toThrow("HTTP 503");
    });

    it("rejects when the underlying fetch call itself rejects (network failure)", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));

      await expect(api.getRuns()).rejects.toThrow("network down");
    });

    it("propagates a rejection from a POST action on a non-2xx response", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "Plan already approved" }, false, 409));

      await expect(api.approvePlan("r1")).rejects.toThrow("Plan already approved");
    });
  });
});
