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
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("GET-style requests", () => {
    it("getRuns fetches without a query string when no state is given", async () => {
      const runs = [{ id: "r1" }];
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ runs }));

      const result = await api.getRuns();

      expect(fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
      expect(result).toEqual({ runs });
    });

    it("getRuns appends the state as a query param when given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ runs: [] }));

      await api.getRuns("Planning");

      expect(fetch).toHaveBeenCalledWith("/api/runs?state=Planning", { headers: {} });
    });

    it("getRun fetches the run detail endpoint by id", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(payload));

      const result = await api.getRun("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1", { headers: {} });
      expect(result).toEqual(payload);
    });

    it("getRunSkills fetches the skills sub-resource", async () => {
      const payload = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(payload));

      const result = await api.getRunSkills("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/skills", { headers: {} });
      expect(result).toEqual(payload);
    });

    it("getArtifacts fetches the artifacts sub-resource", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ artifacts: [] }));

      await api.getArtifacts("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", { headers: {} });
    });

    it("getEvents fetches the events sub-resource", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ events: [] }));

      await api.getEvents("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/events", { headers: {} });
    });

    it("getActiveProcesses fetches without a query string when no runId is given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ processes: [] }));

      await api.getActiveProcesses();

      expect(fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
    });

    it("getActiveProcesses appends runId as a query param when given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ processes: [] }));

      await api.getActiveProcesses("r1");

      expect(fetch).toHaveBeenCalledWith("/api/processes?runId=r1", { headers: {} });
    });

    it("getProcessOutput fetches a process's output by id", async () => {
      const payload = { processId: "p1", output: "hello" };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(payload));

      const result = await api.getProcessOutput("p1");

      expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
      expect(result).toEqual(payload);
    });

    it("fetchPendingIssues fetches the Linear pending-issues endpoint", async () => {
      const issues = [{ id: "i1", title: "t", description: "", state: "Todo", labels: [], priority: 1 }];
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ issues }));

      const result = await api.fetchPendingIssues();

      expect(fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
      expect(result).toEqual({ issues });
    });
  });

  describe("POST-style requests", () => {
    it("approvePlan posts with a note when given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
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

    it("approvePlan sends note as undefined when omitted", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ ok: true, state: "x" }));

      await api.approvePlan("r1");

      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/approve-plan",
        expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
      );
    });

    it("rejectPlan defaults mode to iterate and omits empty context", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ ok: true, state: "x" }));

      await api.rejectPlan("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: undefined, mode: "iterate" }),
      });
    });

    it("rejectPlan forwards an explicit context and mode", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ ok: true, state: "x" }));

      await api.rejectPlan("r1", "needs rework", "fresh");

      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/reject-plan",
        expect.objectContaining({
          body: JSON.stringify({ context: "needs rework", mode: "fresh" }),
        }),
      );
    });

    it("reReviewPlan posts an optional note", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ ok: true, runId: "r1" }));

      await api.reReviewPlan("r1", "note");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "note" }),
      });
    });

    it("revisePlan posts an optional note", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ ok: true, runId: "r1" }));

      await api.revisePlan("r1");

      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/revise-plan",
        expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
      );
    });

    it("approveReview posts with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ ok: true, state: "Done" }));

      await api.approveReview("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
    });

    it("pauseRun posts with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ ok: true }));

      await api.pauseRun("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/pause", {
        headers: {},
        method: "POST",
      });
    });

    it("resumeRun posts with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ ok: true }));

      await api.resumeRun("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/resume", {
        headers: {},
        method: "POST",
      });
    });

    it("retryStage posts with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({ ok: true, state: "Implementing", retrying: true }),
      );

      const result = await api.retryStage("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/retry", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true, state: "Implementing", retrying: true });
    });

    it("ingestIssues posts the given issue ids", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({ ok: true, started: ["i1"], skipped: [] }),
      );

      await api.ingestIssues(["i1", "i2"]);

      expect(fetch).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["i1", "i2"] }),
      });
    });

    it("answerQuestions posts the run id and answers", async () => {
      const answers = [{ questionId: "q1", answer: "yes" }];
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({ ok: true, run: { id: "r1" } }),
      );

      await api.answerQuestions("r1", answers);

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/answer-questions", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ answers }),
      });
    });

    it("sendChatMessage posts the message body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({ reply: "hi", durationMs: 42 }),
      );

      const result = await api.sendChatMessage("r1", "hello");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      });
      expect(result).toEqual({ reply: "hi", durationMs: 42 });
    });
  });

  describe("error handling", () => {
    it("throws the server-provided error message on a non-ok response", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({ error: "Run not found" }, false, 404),
      );

      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to an HTTP status message when the error body has no error field", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({}, false, 500));

      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("falls back to an HTTP status message when the error body isn't valid JSON", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("not json")),
      } as unknown as Response);

      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });

    it("propagates a network failure (fetch rejecting)", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network down"));

      await expect(api.getRuns()).rejects.toThrow("Network down");
    });
  });
});
