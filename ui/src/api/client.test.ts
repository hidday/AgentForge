import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  const ok = init?.ok ?? true;
  const status = init?.status ?? (ok ? 200 : 500);
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("request URL/method/header/body construction", () => {
    it("getRuns() with no filter hits /api/runs with no query string and GET-like headers", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      const result = await api.getRuns();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs");
      expect(options.headers).toEqual({});
      expect(result).toEqual({ runs: [] });
    });

    it("getRuns(state) appends the state as a query param", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns("Planning");

      const [url] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs?state=Planning");
    });

    it("getRun(id) hits /api/runs/:id", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ run: {}, artifacts: [], events: [] }),
      );
      await api.getRun("run-1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/run-1");
    });

    it("getRunSkills(runId) hits /api/runs/:id/skills", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
      );
      await api.getRunSkills("run-1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/run-1/skills");
    });

    it("getArtifacts(runId) hits /api/runs/:id/artifacts", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ artifacts: [] }));
      await api.getArtifacts("run-1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/run-1/artifacts");
    });

    it("getEvents(runId) hits /api/runs/:id/events", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ events: [] }));
      await api.getEvents("run-1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/run-1/events");
    });

    it("approvePlan sends POST with JSON content-type and a note body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
      await api.approvePlan("run-1", "looks good");

      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/approve-plan");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({ "Content-Type": "application/json" });
      expect(options.body).toBe(JSON.stringify({ note: "looks good" }));
    });

    it("approvePlan with no note serializes note as undefined (dropped by JSON.stringify)", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
      await api.approvePlan("run-1");

      const [, options] = fetchMock.mock.calls[0]!;
      expect(options.body).toBe(JSON.stringify({ note: undefined }));
      expect(options.body).toBe("{}");
    });

    it("rejectPlan defaults mode to 'iterate' and passes context through", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));
      await api.rejectPlan("run-1", "needs work");

      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/reject-plan");
      expect(JSON.parse(options.body)).toEqual({ context: "needs work", mode: "iterate" });
    });

    it("rejectPlan honors an explicit mode", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Planning" }));
      await api.rejectPlan("run-1", undefined, "fresh");

      const [, options] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(options.body)).toEqual({ context: undefined, mode: "fresh" });
    });

    it("reReviewPlan posts a note", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.reReviewPlan("run-1", "note");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/re-review-plan");
      expect(JSON.parse(options.body)).toEqual({ note: "note" });
    });

    it("reReviewPlan with no note omits the note field from the body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.reReviewPlan("run-1");
      const [, options] = fetchMock.mock.calls[0]!;
      expect(options.body).toBe("{}");
    });

    it("revisePlan posts a note", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.revisePlan("run-1", "note");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/revise-plan");
      expect(JSON.parse(options.body)).toEqual({ note: "note" });
    });

    it("revisePlan with no note omits the note field from the body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.revisePlan("run-1");
      const [, options] = fetchMock.mock.calls[0]!;
      expect(options.body).toBe("{}");
    });

    it("approveReview posts with no body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Done" }));
      await api.approveReview("run-1");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/approve-review");
      expect(options.method).toBe("POST");
      expect(options.body).toBeUndefined();
      // No body means no Content-Type header should be set.
      expect(options.headers).toEqual({});
    });

    it("pauseRun posts to the pause action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.pauseRun("run-1");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/pause");
      expect(options.method).toBe("POST");
    });

    it("resumeRun posts to the resume action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.resumeRun("run-1");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/resume");
      expect(options.method).toBe("POST");
    });

    it("retryStage posts to the retry action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing", retrying: true }));
      await api.retryStage("run-1");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/retry");
      expect(options.method).toBe("POST");
    });

    it("getActiveProcesses() with no runId omits the query string", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses();
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes");
    });

    it("getActiveProcesses(runId) includes the query string", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses("run-1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes?runId=run-1");
    });

    it("getProcessOutput(processId) hits /api/processes/:id/output", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processId: "p1", output: "hi" }));
      await api.getProcessOutput("p1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes/p1/output");
    });

    it("fetchPendingIssues() hits /api/linear/pending", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));
      await api.fetchPendingIssues();
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/linear/pending");
    });

    it("ingestIssues posts the issueIds array", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: ["a"], skipped: [] }));
      await api.ingestIssues(["a", "b"]);
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/linear/ingest");
      expect(JSON.parse(options.body)).toEqual({ issueIds: ["a", "b"] });
    });

    it("answerQuestions posts the answers array", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, run: {} }));
      const answers = [{ questionId: "q1", answer: "a1" }];
      await api.answerQuestions("run-1", answers);
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/answer-questions");
      expect(JSON.parse(options.body)).toEqual({ answers });
    });

    it("sendChatMessage posts the message and returns the reply", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ reply: "hi there", durationMs: 42 }));
      const result = await api.sendChatMessage("run-1", "hello");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/chat");
      expect(JSON.parse(options.body)).toEqual({ message: "hello" });
      expect(result).toEqual({ reply: "hi there", durationMs: 42 });
    });
  });

  describe("error-response handling", () => {
    it("throws the server-provided error message on a non-2xx response", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: "Run not found" }, { ok: false, status: 404 }),
      );
      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to an 'HTTP <status>' message when the error body has no `error` field", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));
      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("falls back to an 'HTTP <status>' message when the error body isn't valid JSON", async () => {
      const res = {
        ok: false,
        status: 502,
        json: vi.fn().mockRejectedValue(new Error("invalid json")),
      } as unknown as Response;
      fetchMock.mockResolvedValue(res);
      await expect(api.getRuns()).rejects.toThrow("HTTP 502");
    });

    it("propagates a network-level rejection (fetch itself throws)", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      await expect(api.getRuns()).rejects.toThrow("network down");
    });
  });
});
