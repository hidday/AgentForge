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
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("request() success path", () => {
    it("performs a GET without a Content-Type header and returns the parsed JSON", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [{ id: "r1" }] }),
      );

      const result = await api.getRuns();

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs",
        expect.objectContaining({ headers: {} }),
      );
      expect(result).toEqual({ runs: [{ id: "r1" }] });
    });

    it("appends a query string when a state filter is provided", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns("Planning");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs?state=Planning",
        expect.anything(),
      );
    });

    it("sets Content-Type: application/json when a body is present", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Implementing" }),
      );

      await api.approvePlan("run-1", "looks good");

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/approve-plan",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: "looks good" }),
        }),
      );
    });
  });

  describe("request() error paths", () => {
    it("throws the server-provided error message on a non-ok response", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Run not found" }, false, 404),
      );

      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({}, false, 500),
      );

      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error body fails to parse as JSON", async () => {
      const res = {
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error("invalid json")),
      } as unknown as Response;
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res);

      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 502");
    });

    it("propagates a network failure from fetch itself", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network down"));
      await expect(api.getRuns()).rejects.toThrow("Network down");
    });
  });

  describe("endpoint coverage", () => {
    beforeEach(() => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    });

    it("getRun requests /runs/:id", async () => {
      await api.getRun("run-1");
      expect(global.fetch).toHaveBeenCalledWith("/api/runs/run-1", expect.anything());
    });

    it("getRunSkills requests /runs/:id/skills", async () => {
      await api.getRunSkills("run-1");
      expect(global.fetch).toHaveBeenCalledWith("/api/runs/run-1/skills", expect.anything());
    });

    it("getArtifacts requests /runs/:id/artifacts", async () => {
      await api.getArtifacts("run-1");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/artifacts",
        expect.anything(),
      );
    });

    it("getEvents requests /runs/:id/events", async () => {
      await api.getEvents("run-1");
      expect(global.fetch).toHaveBeenCalledWith("/api/runs/run-1/events", expect.anything());
    });

    it("approvePlan omits the note field when none is provided", async () => {
      await api.approvePlan("run-1");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/approve-plan",
        expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
      );
    });

    it("rejectPlan defaults mode to 'iterate' and omits context when absent", async () => {
      await api.rejectPlan("run-1");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/reject-plan",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ context: undefined, mode: "iterate" }),
        }),
      );
    });

    it("rejectPlan passes through an explicit context and mode", async () => {
      await api.rejectPlan("run-1", "needs more detail", "fresh");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/reject-plan",
        expect.objectContaining({
          body: JSON.stringify({ context: "needs more detail", mode: "fresh" }),
        }),
      );
    });

    it("reReviewPlan posts to the re-review-plan action", async () => {
      await api.reReviewPlan("run-1", "note");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/re-review-plan",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ note: "note" }) }),
      );
    });

    it("reReviewPlan omits the note field when none is provided", async () => {
      await api.reReviewPlan("run-1");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/re-review-plan",
        expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
      );
    });

    it("revisePlan posts to the revise-plan action", async () => {
      await api.revisePlan("run-1");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/revise-plan",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("approveReview posts with no body", async () => {
      await api.approveReview("run-1");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/approve-review",
        expect.objectContaining({ method: "POST", headers: {} }),
      );
    });

    it("pauseRun posts to the pause action", async () => {
      await api.pauseRun("run-1");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/pause",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("resumeRun posts to the resume action", async () => {
      await api.resumeRun("run-1");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/resume",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("retryStage posts to the retry action", async () => {
      await api.retryStage("run-1");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/retry",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("getActiveProcesses without a runId omits the query string", async () => {
      await api.getActiveProcesses();
      expect(global.fetch).toHaveBeenCalledWith("/api/processes", expect.anything());
    });

    it("getActiveProcesses with a runId appends the query string", async () => {
      await api.getActiveProcesses("run-1");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/processes?runId=run-1",
        expect.anything(),
      );
    });

    it("getProcessOutput requests /processes/:id/output", async () => {
      await api.getProcessOutput("proc-1");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/processes/proc-1/output",
        expect.anything(),
      );
    });

    it("fetchPendingIssues requests /linear/pending", async () => {
      await api.fetchPendingIssues();
      expect(global.fetch).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
    });

    it("ingestIssues posts the issue id list", async () => {
      await api.ingestIssues(["a", "b"]);
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/linear/ingest",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ issueIds: ["a", "b"] }),
        }),
      );
    });

    it("answerQuestions posts the answers array", async () => {
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("run-1", answers);
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/answer-questions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ answers }),
        }),
      );
    });

    it("sendChatMessage posts the message to the chat endpoint", async () => {
      await api.sendChatMessage("run-1", "hello");
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/chat",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ message: "hello" }),
        }),
      );
    });
  });
});
