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

  describe("GET requests", () => {
    it("getRuns() calls /api/runs with no query when stateFilter is omitted", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
      const result = await api.getRuns();
      expect(fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
      expect(result).toEqual({ runs: [] });
    });

    it("getRuns(state) appends ?state= to the URL", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns("Planning");
      expect(fetch).toHaveBeenCalledWith("/api/runs?state=Planning", { headers: {} });
    });

    it("getRun(id) requests /api/runs/:id and returns the parsed body", async () => {
      const body = { run: { id: "r1" }, artifacts: [], events: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(body));
      const result = await api.getRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1", { headers: {} });
      expect(result).toEqual(body);
    });

    it("getRunSkills(runId) requests /api/runs/:id/skills", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
      );
      await api.getRunSkills("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/skills", { headers: {} });
    });

    it("getArtifacts(runId) requests /api/runs/:id/artifacts", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ artifacts: [] }));
      await api.getArtifacts("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", { headers: {} });
    });

    it("getEvents(runId) requests /api/runs/:id/events", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ events: [] }));
      await api.getEvents("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/events", { headers: {} });
    });

    it("getActiveProcesses() with no runId omits the query string", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses();
      expect(fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
    });

    it("getActiveProcesses(runId) appends ?runId=", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses("r1");
      expect(fetch).toHaveBeenCalledWith("/api/processes?runId=r1", { headers: {} });
    });

    it("getProcessOutput(processId) requests /api/processes/:id/output", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ processId: "p1", output: "log" }),
      );
      const result = await api.getProcessOutput("p1");
      expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
      expect(result).toEqual({ processId: "p1", output: "log" });
    });

    it("fetchPendingIssues() requests /api/linear/pending", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ issues: [] }));
      await api.fetchPendingIssues();
      expect(fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
    });
  });

  describe("POST requests with bodies", () => {
    it("approvePlan sends a POST with JSON content-type and the note in the body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Implementing" }),
      );
      const result = await api.approvePlan("r1", "looks good");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
      expect(result).toEqual({ ok: true, state: "Implementing" });
    });

    it("approvePlan omits the note when not provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.approvePlan("r1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/approve-plan",
        expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
      );
    });

    it("rejectPlan defaults mode to 'iterate' when not provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.rejectPlan("r1", "needs work");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/reject-plan",
        expect.objectContaining({
          body: JSON.stringify({ context: "needs work", mode: "iterate" }),
        }),
      );
    });

    it("rejectPlan forwards an explicit 'fresh' mode", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.rejectPlan("r1", "needs work", "fresh");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/reject-plan",
        expect.objectContaining({
          body: JSON.stringify({ context: "needs work", mode: "fresh" }),
        }),
      );
    });

    it("reReviewPlan and revisePlan POST to their respective action endpoints", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      await api.reReviewPlan("r1", "note");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/re-review-plan",
        expect.objectContaining({ method: "POST" }),
      );

      await api.revisePlan("r1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/revise-plan",
        expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
      );
    });

    it("approveReview, pauseRun, resumeRun, and retryStage POST with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

      await api.approveReview("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-review", {
        headers: {},
        method: "POST",
      });

      await api.pauseRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/pause", {
        headers: {},
        method: "POST",
      });

      await api.resumeRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/resume", {
        headers: {},
        method: "POST",
      });

      await api.retryStage("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/retry", {
        headers: {},
        method: "POST",
      });
    });

    it("ingestIssues POSTs the issueIds array as JSON", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, started: ["a"], skipped: [] }),
      );
      await api.ingestIssues(["a", "b"]);
      expect(fetch).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["a", "b"] }),
      });
    });

    it("answerQuestions POSTs the answers array", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, run: { id: "r1" } }),
      );
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("r1", answers);
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/answer-questions", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ answers }),
      });
    });

    it("sendChatMessage POSTs the message and returns the reply", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ reply: "hi", durationMs: 12 }),
      );
      const result = await api.sendChatMessage("r1", "hello");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      });
      expect(result).toEqual({ reply: "hi", durationMs: 12 });
    });
  });

  describe("error handling", () => {
    it("throws the server-provided error message when the response is not ok", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Run not found" }, false, 404),
      );
      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to an 'HTTP <status>' message when the error body has no error field", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error body isn't valid JSON", async () => {
      const res = {
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("not json")),
      } as unknown as Response;
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res);
      await expect(api.getRun("r1")).rejects.toThrow("HTTP 503");
    });

    it("propagates network failures from fetch itself", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
      await expect(api.getRuns()).rejects.toThrow("network down");
    });
  });
});
