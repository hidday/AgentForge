import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
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

  // -------------------------------------------------------------------------
  // Query / URL construction
  // -------------------------------------------------------------------------
  describe("getRuns", () => {
    it("requests /api/runs with no query string when state is omitted", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns();
      expect(fetchMock).toHaveBeenCalledWith("/api/runs", {
        headers: {},
      });
    });

    it("appends ?state=<state> when a state filter is given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns("Planning");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs?state=Planning", {
        headers: {},
      });
    });

    it("resolves with the parsed runs payload", async () => {
      const runs = [{ id: "r1" }];
      fetchMock.mockResolvedValue(jsonResponse({ runs }));
      const result = await api.getRuns();
      expect(result).toEqual({ runs });
    });
  });

  describe("getRun", () => {
    it("requests /api/runs/:id", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ run: {}, artifacts: [], events: [] }));
      await api.getRun("abc-123");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/abc-123", { headers: {} });
    });
  });

  describe("getRunSkills", () => {
    it("requests /api/runs/:id/skills", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
      );
      await api.getRunSkills("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/skills", { headers: {} });
    });
  });

  describe("getArtifacts", () => {
    it("requests /api/runs/:id/artifacts", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ artifacts: [] }));
      await api.getArtifacts("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/artifacts", { headers: {} });
    });
  });

  describe("getEvents", () => {
    it("requests /api/runs/:id/events", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ events: [] }));
      await api.getEvents("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/events", { headers: {} });
    });
  });

  // -------------------------------------------------------------------------
  // POST actions: body serialization
  // -------------------------------------------------------------------------
  describe("approvePlan", () => {
    it("POSTs with a JSON body containing the note and sets Content-Type", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
      await api.approvePlan("run-1", "looks good");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
    });

    it("omits the note from the body when not provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
      await api.approvePlan("run-1");
      const call = fetchMock.mock.calls[0];
      expect(call[1].body).toBe(JSON.stringify({ note: undefined }));
      expect(JSON.parse(call[1].body)).toEqual({});
    });
  });

  describe("rejectPlan", () => {
    it("defaults mode to 'iterate' when not given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));
      await api.rejectPlan("run-1");
      const call = fetchMock.mock.calls[0];
      expect(call[0]).toBe("/api/runs/run-1/actions/reject-plan");
      expect(JSON.parse(call[1].body)).toEqual({ context: undefined, mode: "iterate" });
    });

    it("sends the given context and mode", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));
      await api.rejectPlan("run-1", "needs more detail", "fresh");
      const call = fetchMock.mock.calls[0];
      expect(JSON.parse(call[1].body)).toEqual({ context: "needs more detail", mode: "fresh" });
    });
  });

  describe("reReviewPlan", () => {
    it("POSTs to the re-review-plan action with a note", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.reReviewPlan("run-1", "re-check");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "re-check" }),
      });
    });

    it("omits the note from the body when not provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.reReviewPlan("run-1");
      const call = fetchMock.mock.calls[0];
      expect(JSON.parse(call[1].body)).toEqual({});
    });
  });

  describe("revisePlan", () => {
    it("POSTs to the revise-plan action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.revisePlan("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("approveReview", () => {
    it("POSTs with no body and no Content-Type header", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Done" }));
      await api.approveReview("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
    });
  });

  describe("pauseRun / resumeRun / retryStage", () => {
    it("pauseRun POSTs with no body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.pauseRun("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/pause", {
        headers: {},
        method: "POST",
      });
    });

    it("resumeRun POSTs with no body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.resumeRun("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/resume", {
        headers: {},
        method: "POST",
      });
    });

    it("retryStage POSTs with no body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Planning", retrying: true }));
      await api.retryStage("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/retry", {
        headers: {},
        method: "POST",
      });
    });
  });

  describe("getActiveProcesses", () => {
    it("requests /api/processes with no filter", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses();
      expect(fetchMock).toHaveBeenCalledWith("/api/processes", { headers: {} });
    });

    it("appends ?runId=<id> when given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=run-1", { headers: {} });
    });
  });

  describe("getProcessOutput", () => {
    it("requests /api/processes/:id/output", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processId: "p1", output: "hi" }));
      await api.getProcessOutput("p1");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
    });
  });

  describe("fetchPendingIssues", () => {
    it("requests /api/linear/pending", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));
      await api.fetchPendingIssues();
      expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
    });
  });

  describe("ingestIssues", () => {
    it("POSTs the issueIds array as JSON", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: ["a"], skipped: [] }));
      await api.ingestIssues(["a", "b"]);
      expect(fetchMock).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["a", "b"] }),
      });
    });
  });

  describe("answerQuestions", () => {
    it("POSTs the answers array as JSON", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, run: {} }));
      const answers = [{ questionId: "q1", answer: "42" }];
      await api.answerQuestions("run-1", answers);
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/answer-questions", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ answers }),
      });
    });
  });

  describe("sendChatMessage", () => {
    it("POSTs the message as JSON and resolves with the reply", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ reply: "hello", durationMs: 12 }));
      const result = await api.sendChatMessage("run-1", "hi there");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "hi there" }),
      });
      expect(result).toEqual({ reply: "hello", durationMs: 12 });
    });
  });

  // -------------------------------------------------------------------------
  // Error handling (shared `request` helper)
  // -------------------------------------------------------------------------
  describe("error handling", () => {
    it("throws an Error using the server-provided error message on a non-ok response", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "Run not found" }, false, 404));
      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error body cannot be parsed as JSON", async () => {
      const res = {
        ok: false,
        status: 503,
        json: vi.fn().mockRejectedValue(new Error("not json")),
      } as unknown as Response;
      fetchMock.mockResolvedValue(res);
      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 503");
    });

    it("propagates network failures from fetch itself", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      await expect(api.getRuns()).rejects.toThrow("network down");
    });
  });
});
