import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("api client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("request() internals (via api.getRuns)", () => {
    it("GETs the base path with no query string when no state filter is given", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [] }),
      );
      await api.getRuns();
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs", {
        headers: {},
      });
    });

    it("appends a state query param when provided", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [] }),
      );
      await api.getRuns("Done");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs?state=Done", {
        headers: {},
      });
    });

    it("resolves with the parsed JSON body on success", async () => {
      const payload = { runs: [{ id: "run-1" }] };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));
      const result = await api.getRuns();
      expect(result).toEqual(payload);
    });

    it("throws the server-provided error message on a non-ok response", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Run not found" }, false, 404),
      );
      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to an 'HTTP <status>' message when the error body has no error field", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({}, false, 500),
      );
      await expect(api.getRun("x")).rejects.toThrow("HTTP 500");
    });

    it("falls back to an 'HTTP <status>' message when the error body isn't valid JSON", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("not json")),
      } as unknown as Response);
      await expect(api.getRun("x")).rejects.toThrow("HTTP 503");
    });

    it("sets Content-Type: application/json only when a body is present", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Done" }),
      );
      await api.approvePlan("run-1", "looks good");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
    });
  });

  describe("per-endpoint request construction", () => {
    beforeEach(() => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    });

    it("getRun builds the run detail path", async () => {
      await api.getRun("run-42");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-42", { headers: {} });
    });

    it("getRunSkills builds the skills path", async () => {
      await api.getRunSkills("run-42");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-42/skills", { headers: {} });
    });

    it("getArtifacts builds the artifacts path", async () => {
      await api.getArtifacts("run-42");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-42/artifacts", {
        headers: {},
      });
    });

    it("getEvents builds the events path", async () => {
      await api.getEvents("run-42");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-42/events", { headers: {} });
    });

    it("approvePlan omits note when none is given", async () => {
      await api.approvePlan("run-1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });

    it("rejectPlan defaults mode to 'iterate' when not given", async () => {
      await api.rejectPlan("run-1", "needs rework");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: "needs rework", mode: "iterate" }),
      });
    });

    it("rejectPlan passes an explicit 'fresh' mode through", async () => {
      await api.rejectPlan("run-1", undefined, "fresh");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: undefined, mode: "fresh" }),
      });
    });

    it("reReviewPlan posts to the re-review-plan action", async () => {
      await api.reReviewPlan("run-1", "ping");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "ping" }),
      });
    });

    it("reReviewPlan omits note when none is given", async () => {
      await api.reReviewPlan("run-1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });

    it("revisePlan posts to the revise-plan action", async () => {
      await api.revisePlan("run-1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });

    it("approveReview posts with no body (no Content-Type header)", async () => {
      await api.approveReview("run-1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
    });

    it("pauseRun posts to the pause action", async () => {
      await api.pauseRun("run-1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/pause", {
        headers: {},
        method: "POST",
      });
    });

    it("resumeRun posts to the resume action", async () => {
      await api.resumeRun("run-1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/resume", {
        headers: {},
        method: "POST",
      });
    });

    it("retryStage posts to the retry action", async () => {
      await api.retryStage("run-1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/retry", {
        headers: {},
        method: "POST",
      });
    });

    it("getActiveProcesses omits the query string when no runId is given", async () => {
      await api.getActiveProcesses();
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
    });

    it("getActiveProcesses appends ?runId= when given", async () => {
      await api.getActiveProcesses("run-1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes?runId=run-1", {
        headers: {},
      });
    });

    it("getProcessOutput builds the process output path", async () => {
      await api.getProcessOutput("proc-1");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes/proc-1/output", {
        headers: {},
      });
    });

    it("fetchPendingIssues GETs the linear pending path", async () => {
      await api.fetchPendingIssues();
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
    });

    it("ingestIssues posts the issueIds array", async () => {
      await api.ingestIssues(["a", "b"]);
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["a", "b"] }),
      });
    });

    it("answerQuestions posts the answers array", async () => {
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("run-1", answers);
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/answer-questions", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ answers }),
      });
    });

    it("sendChatMessage posts the chat message", async () => {
      await api.sendChatMessage("run-1", "hello");
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      });
    });
  });
});
