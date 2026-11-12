import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("request behavior (via getRuns)", () => {
    it("sends a GET request to the correct URL with no body/content-type header", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));

      const result = await api.getRuns();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs");
      expect(opts.headers).toEqual({});
      expect(result).toEqual({ runs: [] });
    });

    it("appends the state query param when provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));

      await api.getRuns("running");

      const [url] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs?state=running");
    });

    it("sets Content-Type header and serializes body on POST requests", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "approved" }));

      await api.approvePlan("run-1", "looks good");

      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/approve-plan");
      expect(opts.method).toBe("POST");
      expect(opts.headers).toEqual({ "Content-Type": "application/json" });
      expect(opts.body).toBe(JSON.stringify({ note: "looks good" }));
    });

    it("throws an Error using the parsed error body message on non-ok response", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: "Run not found" }, false, 404),
      );

      await expect(api.getRun("missing-run")).rejects.toThrow("Run not found");
    });

    it("falls back to an HTTP status message when the error body has no error field", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));

      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to an HTTP status message when the error body fails to parse as JSON", async () => {
      const res = {
        ok: false,
        status: 503,
        json: vi.fn().mockRejectedValue(new Error("invalid json")),
      } as unknown as Response;
      fetchMock.mockResolvedValue(res);

      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 503");
    });

    it("propagates a network rejection (fetch itself throwing)", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));

      await expect(api.getRun("run-1")).rejects.toThrow("network down");
    });

    it("rejects when the successful response body is malformed JSON", async () => {
      const res = {
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
      } as unknown as Response;
      fetchMock.mockResolvedValue(res);

      await expect(api.getRun("run-1")).rejects.toThrow("Unexpected token");
    });
  });

  describe("individual endpoint methods", () => {
    it("getRun builds /runs/:id and returns parsed payload", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      fetchMock.mockResolvedValue(jsonResponse(payload));

      const result = await api.getRun("r1");

      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r1");
      expect(result).toEqual(payload);
    });

    it("getRunSkills builds /runs/:id/skills", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
      );

      await api.getRunSkills("r1");

      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r1/skills");
    });

    it("getArtifacts builds /runs/:id/artifacts", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ artifacts: [] }));

      await api.getArtifacts("r1");

      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r1/artifacts");
    });

    it("getEvents builds /runs/:id/events", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ events: [] }));

      await api.getEvents("r1");

      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r1/events");
    });

    it("approvePlan omits note from body when not provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "approved" }));

      await api.approvePlan("r1");

      const [, opts] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(opts.body)).toEqual({ note: undefined });
    });

    it("rejectPlan defaults mode to 'iterate' and includes context", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "rejected" }));

      await api.rejectPlan("r1", "needs rework");

      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/reject-plan");
      expect(JSON.parse(opts.body)).toEqual({ context: "needs rework", mode: "iterate" });
    });

    it("rejectPlan accepts an explicit mode and no context", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "rejected" }));

      await api.rejectPlan("r1", undefined, "fresh");

      const [, opts] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(opts.body)).toEqual({ context: undefined, mode: "fresh" });
    });

    it("reReviewPlan posts to the re-review-plan action with note", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

      await api.reReviewPlan("r1", "re-review please");

      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/re-review-plan");
      expect(JSON.parse(opts.body)).toEqual({ note: "re-review please" });
    });

    it("reReviewPlan omits note from body when not provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

      await api.reReviewPlan("r1");

      const [, opts] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(opts.body)).toEqual({ note: undefined });
    });

    it("revisePlan posts to the revise-plan action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

      await api.revisePlan("r1");

      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/revise-plan");
      expect(JSON.parse(opts.body)).toEqual({ note: undefined });
    });

    it("revisePlan includes note in body when provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

      await api.revisePlan("r1", "please revise");

      const [, opts] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(opts.body)).toEqual({ note: "please revise" });
    });

    it("approveReview posts with no body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "reviewed" }));

      await api.approveReview("r1");

      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/approve-review");
      expect(opts.method).toBe("POST");
      expect(opts.body).toBeUndefined();
      expect(opts.headers).toEqual({});
    });

    it("pauseRun posts to the pause action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

      await api.pauseRun("r1");

      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/pause");
      expect(opts.method).toBe("POST");
    });

    it("resumeRun posts to the resume action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

      await api.resumeRun("r1");

      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/resume");
      expect(opts.method).toBe("POST");
    });

    it("retryStage posts to the retry action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "running", retrying: true }));

      await api.retryStage("r1");

      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/retry");
      expect(opts.method).toBe("POST");
    });

    it("getActiveProcesses without runId omits the query string", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));

      await api.getActiveProcesses();

      expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes");
    });

    it("getActiveProcesses with runId includes the query string", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));

      await api.getActiveProcesses("r1");

      expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes?runId=r1");
    });

    it("getProcessOutput builds /processes/:id/output", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processId: "p1", output: "log" }));

      const result = await api.getProcessOutput("p1");

      expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes/p1/output");
      expect(result).toEqual({ processId: "p1", output: "log" });
    });

    it("fetchPendingIssues calls /linear/pending", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));

      await api.fetchPendingIssues();

      expect(fetchMock.mock.calls[0]![0]).toBe("/api/linear/pending");
    });

    it("ingestIssues posts the issueIds array", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: ["a"], skipped: [] }));

      await api.ingestIssues(["a", "b"]);

      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/linear/ingest");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({ issueIds: ["a", "b"] });
    });

    it("answerQuestions posts runId-scoped answers", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, run: { id: "r1" } }));

      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("r1", answers);

      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/answer-questions");
      expect(JSON.parse(opts.body)).toEqual({ answers });
    });

    it("sendChatMessage posts the message and returns the reply", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ reply: "hi", durationMs: 12 }));

      const result = await api.sendChatMessage("r1", "hello");

      const [url, opts] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/chat");
      expect(JSON.parse(opts.body)).toEqual({ message: "hello" });
      expect(result).toEqual({ reply: "hi", durationMs: 12 });
    });
  });
});
