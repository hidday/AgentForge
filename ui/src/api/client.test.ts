import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("request building", () => {
    it("getRuns without a state filter hits /api/runs with no query string", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns();
      expect(fetch).toHaveBeenCalledWith("/api/runs", expect.objectContaining({ headers: {} }));
    });

    it("getRuns with a state filter appends ?state=", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns("Planning");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs?state=Planning",
        expect.objectContaining({ headers: {} }),
      );
    });

    it("getRun requests /api/runs/:id", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ run: {}, artifacts: [], events: [] }),
      );
      await api.getRun("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1", expect.objectContaining({ headers: {} }));
    });

    it("getRunSkills requests /api/runs/:id/skills", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
      );
      await api.getRunSkills("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/skills",
        expect.objectContaining({ headers: {} }),
      );
    });

    it("getArtifacts requests /api/runs/:id/artifacts", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ artifacts: [] }));
      await api.getArtifacts("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/artifacts",
        expect.objectContaining({ headers: {} }),
      );
    });

    it("getEvents requests /api/runs/:id/events", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ events: [] }));
      await api.getEvents("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/events",
        expect.objectContaining({ headers: {} }),
      );
    });

    it("approvePlan POSTs a note when provided, and sets JSON content-type header", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.approvePlan("run-1", "lgtm");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "lgtm" }),
      });
    });

    it("approvePlan omits the note field when not provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.approvePlan("run-1");
      const body = JSON.parse(
        (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
      );
      expect(body).toEqual({ note: undefined });
    });

    it("rejectPlan defaults mode to 'iterate' when not provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.rejectPlan("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/reject-plan",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ context: undefined, mode: "iterate" }),
        }),
      );
    });

    it("rejectPlan passes through explicit context and mode", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.rejectPlan("run-1", "needs rework", "fresh");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/reject-plan",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ context: "needs rework", mode: "fresh" }),
        }),
      );
    });

    it("reReviewPlan POSTs to the re-review-plan action", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.reReviewPlan("run-1", "note");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/re-review-plan",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ note: "note" }) }),
      );
    });

    it("reReviewPlan omits the note field when not provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.reReviewPlan("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/re-review-plan",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ note: undefined }) }),
      );
    });

    it("revisePlan POSTs to the revise-plan action", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.revisePlan("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/revise-plan",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ note: undefined }) }),
      );
    });

    it("approveReview POSTs with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.approveReview("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
    });

    it("pauseRun POSTs to the pause action", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
      await api.pauseRun("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/pause",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("resumeRun POSTs to the resume action", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
      await api.resumeRun("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/resume",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("retryStage POSTs to the retry action", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "x", retrying: true }),
      );
      await api.retryStage("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/retry",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("getActiveProcesses without a runId hits /api/processes", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses();
      expect(fetch).toHaveBeenCalledWith("/api/processes", expect.objectContaining({ headers: {} }));
    });

    it("getActiveProcesses with a runId appends ?runId=", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/processes?runId=run-1",
        expect.objectContaining({ headers: {} }),
      );
    });

    it("getProcessOutput requests /api/processes/:id/output", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ processId: "p1", output: "log" }),
      );
      await api.getProcessOutput("p1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/processes/p1/output",
        expect.objectContaining({ headers: {} }),
      );
    });

    it("fetchPendingIssues requests /api/linear/pending", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ issues: [] }));
      await api.fetchPendingIssues();
      expect(fetch).toHaveBeenCalledWith(
        "/api/linear/pending",
        expect.objectContaining({ headers: {} }),
      );
    });

    it("ingestIssues POSTs the issueIds array", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, started: [], skipped: [] }),
      );
      await api.ingestIssues(["i1", "i2"]);
      expect(fetch).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["i1", "i2"] }),
      });
    });

    it("answerQuestions POSTs the answers array", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, run: {} }));
      const answers = [{ questionId: "q1", answer: "a1" }];
      await api.answerQuestions("run-1", answers);
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/answer-questions", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ answers }),
      });
    });

    it("sendChatMessage POSTs the message", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ reply: "hi", durationMs: 5 }),
      );
      await api.sendChatMessage("run-1", "hello");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      });
    });
  });

  describe("response handling", () => {
    it("resolves with the parsed JSON body on a successful response", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [{ id: "r1" }] }));
      const result = await api.getRuns();
      expect(result).toEqual({ runs: [{ id: "r1" }] });
    });

    it("throws the server-provided error message on a non-ok JSON response", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Run not found" }, false, 404),
      );
      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to an HTTP status message when the error body has no 'error' field", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("falls back to an HTTP status message when the error body isn't valid JSON", async () => {
      const res = {
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("invalid json")),
      } as unknown as Response;
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res);
      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });
  });
});
