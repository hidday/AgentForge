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
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getRuns", () => {
    it("requests /api/runs with no query string when no filter is given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
      const result = await api.getRuns();
      expect(fetch).toHaveBeenCalledWith("/api/runs", expect.objectContaining({ headers: {} }));
      expect(result).toEqual({ runs: [] });
    });

    it("appends a state query param when a filter is given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns("Done");
      expect(fetch).toHaveBeenCalledWith("/api/runs?state=Done", expect.anything());
    });
  });

  describe("getRun", () => {
    it("requests /api/runs/:id and returns the parsed body", async () => {
      const body = { run: { id: "r1" }, artifacts: [], events: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(body));
      const result = await api.getRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1", expect.anything());
      expect(result).toEqual(body);
    });
  });

  describe("getRunSkills", () => {
    it("requests /api/runs/:id/skills", async () => {
      const body = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(body));
      const result = await api.getRunSkills("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/skills", expect.anything());
      expect(result).toEqual(body);
    });
  });

  describe("getArtifacts", () => {
    it("requests /api/runs/:id/artifacts", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ artifacts: [] }));
      await api.getArtifacts("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", expect.anything());
    });
  });

  describe("getEvents", () => {
    it("requests /api/runs/:id/events", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ events: [] }));
      await api.getEvents("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/events", expect.anything());
    });
  });

  describe("approvePlan", () => {
    it("POSTs with a note when one is given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
      await api.approvePlan("r1", "looks good");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/approve-plan",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ note: "looks good" }),
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    it("sends note: undefined when no note is given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
      await api.approvePlan("r1");
      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(JSON.parse(options.body as string)).toEqual({});
    });
  });

  describe("rejectPlan", () => {
    it("POSTs context and mode, defaulting mode to 'iterate'", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));
      await api.rejectPlan("r1", "needs work");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/reject-plan",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ context: "needs work", mode: "iterate" }),
        }),
      );
    });

    it("allows passing mode: 'fresh' explicitly", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));
      await api.rejectPlan("r1", "restart", "fresh");
      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(JSON.parse(options.body as string)).toEqual({ context: "restart", mode: "fresh" });
    });
  });

  describe("reReviewPlan", () => {
    it("POSTs to the re-review-plan endpoint", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      await api.reReviewPlan("r1", "note");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/re-review-plan",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("revisePlan", () => {
    it("POSTs to the revise-plan endpoint", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      await api.revisePlan("r1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/revise-plan",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("approveReview", () => {
    it("POSTs to the approve-review endpoint with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Done" }));
      await api.approveReview("r1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/approve-review",
        expect.objectContaining({ method: "POST" }),
      );
      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(options.headers).toEqual({});
    });
  });

  describe("pauseRun / resumeRun / retryStage", () => {
    it("pauseRun POSTs to /actions/pause", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
      await api.pauseRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/pause", expect.objectContaining({ method: "POST" }));
    });

    it("resumeRun POSTs to /actions/resume", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
      await api.resumeRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/resume", expect.objectContaining({ method: "POST" }));
    });

    it("retryStage POSTs to /actions/retry", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Implementing", retrying: true }),
      );
      await api.retryStage("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/retry", expect.objectContaining({ method: "POST" }));
    });
  });

  describe("getActiveProcesses", () => {
    it("requests /api/processes with no query when runId is omitted", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses();
      expect(fetch).toHaveBeenCalledWith("/api/processes", expect.anything());
    });

    it("appends runId as a query param when given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses("r1");
      expect(fetch).toHaveBeenCalledWith("/api/processes?runId=r1", expect.anything());
    });
  });

  describe("getProcessOutput", () => {
    it("requests /api/processes/:id/output", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ processId: "p1", output: "hi" }),
      );
      const result = await api.getProcessOutput("p1");
      expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", expect.anything());
      expect(result).toEqual({ processId: "p1", output: "hi" });
    });
  });

  describe("fetchPendingIssues", () => {
    it("requests /api/linear/pending", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ issues: [] }));
      await api.fetchPendingIssues();
      expect(fetch).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
    });
  });

  describe("ingestIssues", () => {
    it("POSTs the given issue ids", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, started: ["a"], skipped: [] }),
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
  });

  describe("answerQuestions", () => {
    it("POSTs the given answers", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, run: { id: "r1" } }),
      );
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("r1", answers);
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/answer-questions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ answers }),
        }),
      );
    });
  });

  describe("sendChatMessage", () => {
    it("POSTs the message and returns the reply", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ reply: "hello back", durationMs: 42 }),
      );
      const result = await api.sendChatMessage("r1", "hello");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/chat",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ message: "hello" }),
        }),
      );
      expect(result).toEqual({ reply: "hello back", durationMs: 42 });
    });
  });

  describe("error handling", () => {
    it("throws the error message from the response body on a non-2xx status", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Run not found" }, false, 404),
      );
      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error body is not valid JSON", async () => {
      const res = {
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("bad json")),
      } as unknown as Response;
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res);
      await expect(api.getRun("r1")).rejects.toThrow("HTTP 503");
    });

    it("propagates a network failure (fetch rejecting)", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
      await expect(api.getRun("r1")).rejects.toThrow("network down");
    });

    it("propagates malformed JSON in a successful response", async () => {
      const res = {
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("Unexpected token")),
      } as unknown as Response;
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res);
      await expect(api.getRun("r1")).rejects.toThrow("Unexpected token");
    });
  });
});
