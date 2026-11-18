import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("request shaping", () => {
    it("GETs /api/runs with no query string when no state filter is given", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [] }),
      );
      await api.getRuns();
      expect(fetch).toHaveBeenCalledWith("/api/runs", expect.objectContaining({ headers: {} }));
    });

    it("GETs /api/runs?state=X when a state filter is given", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [] }),
      );
      await api.getRuns("Done");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs?state=Done",
        expect.objectContaining({ headers: {} }),
      );
    });

    it("GETs /api/runs/:id for getRun", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ run: {}, artifacts: [], events: [] }),
      );
      await api.getRun("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1", expect.anything());
    });

    it("GETs /api/runs/:id/skills for getRunSkills", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
      );
      await api.getRunSkills("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/skills", expect.anything());
    });

    it("GETs /api/runs/:id/artifacts for getArtifacts", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ artifacts: [] }),
      );
      await api.getArtifacts("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/artifacts", expect.anything());
    });

    it("GETs /api/runs/:id/events for getEvents", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ events: [] }),
      );
      await api.getEvents("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/events", expect.anything());
    });

    it("POSTs approve-plan with a note, setting Content-Type and body", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Implementing" }),
      );
      await api.approvePlan("run-1", "go ahead");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "go ahead" }),
      });
    });

    it("POSTs approve-plan with note:undefined when no note is given", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Implementing" }),
      );
      await api.approvePlan("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/approve-plan",
        expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
      );
    });

    it("POSTs reject-plan with context and default mode 'iterate'", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Planning" }),
      );
      await api.rejectPlan("run-1", "needs work");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/reject-plan",
        expect.objectContaining({
          body: JSON.stringify({ context: "needs work", mode: "iterate" }),
        }),
      );
    });

    it("POSTs reject-plan with the 'fresh' mode when given", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Planning" }),
      );
      await api.rejectPlan("run-1", undefined, "fresh");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/reject-plan",
        expect.objectContaining({
          body: JSON.stringify({ context: undefined, mode: "fresh" }),
        }),
      );
    });

    it("POSTs re-review-plan", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, runId: "run-1" }),
      );
      await api.reReviewPlan("run-1", "focus on tests");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/re-review-plan",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ note: "focus on tests" }),
        }),
      );
    });

    it("POSTs re-review-plan with note:undefined when no note is given", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, runId: "run-1" }),
      );
      await api.reReviewPlan("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/re-review-plan",
        expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
      );
    });

    it("POSTs revise-plan", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, runId: "run-1" }),
      );
      await api.revisePlan("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/revise-plan",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("POSTs approve-review with no body", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Done" }),
      );
      await api.approveReview("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
    });

    it("POSTs pause", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
      await api.pauseRun("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/pause",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("POSTs resume", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
      await api.resumeRun("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/resume",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("POSTs retry", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Implementing", retrying: true }),
      );
      await api.retryStage("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/retry",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("GETs /api/processes with no query string when no runId is given", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ processes: [] }),
      );
      await api.getActiveProcesses();
      expect(fetch).toHaveBeenCalledWith("/api/processes", expect.anything());
    });

    it("GETs /api/processes?runId=X when a runId is given", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ processes: [] }),
      );
      await api.getActiveProcesses("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/processes?runId=run-1", expect.anything());
    });

    it("GETs /api/processes/:id/output", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ processId: "p1", output: "hi" }),
      );
      await api.getProcessOutput("p1");
      expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", expect.anything());
    });

    it("GETs /api/linear/pending", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ issues: [] }),
      );
      await api.fetchPendingIssues();
      expect(fetch).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
    });

    it("POSTs /api/linear/ingest with issueIds", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, started: [], skipped: [] }),
      );
      await api.ingestIssues(["a", "b"]);
      expect(fetch).toHaveBeenCalledWith(
        "/api/linear/ingest",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ issueIds: ["a", "b"] }),
        }),
      );
    });

    it("POSTs answer-questions with the answers array", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, run: {} }),
      );
      const answers = [{ questionId: "q1", answer: "a1" }];
      await api.answerQuestions("run-1", answers);
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/answer-questions",
        expect.objectContaining({ body: JSON.stringify({ answers }) }),
      );
    });

    it("POSTs chat with the message", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ reply: "hi", durationMs: 10 }),
      );
      await api.sendChatMessage("run-1", "hello");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/chat",
        expect.objectContaining({ body: JSON.stringify({ message: "hello" }) }),
      );
    });
  });

  describe("responses", () => {
    it("resolves with the parsed JSON body on success", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [{ id: "run-1" }] }),
      );
      const result = await api.getRuns();
      expect(result).toEqual({ runs: [{ id: "run-1" }] });
    });

    it("throws the server-provided error message on a non-ok response", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Run not found" }, false, 404),
      );
      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({}, false, 500),
      );
      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error response body isn't valid JSON", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("not json")),
      } as unknown as Response);
      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 503");
    });
  });
});
