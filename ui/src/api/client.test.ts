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
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("request() building blocks (via getRuns)", () => {
    it("issues a GET with no body and no Content-Type header when no state filter given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      const result = await api.getRuns();
      expect(fetchMock).toHaveBeenCalledWith("/api/runs", { headers: {} });
      expect(result).toEqual({ runs: [] });
    });

    it("appends the state query param when provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns("running");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs?state=running", { headers: {} });
    });

    it("throws the server-provided error message on non-2xx response", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "Not found" }, false, 404));
      await expect(api.getRuns()).rejects.toThrow("Not found");
    });

    it("falls back to 'HTTP <status>' when error body has no error field", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when error body is malformed JSON", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("bad json")),
      } as unknown as Response);
      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });

    it("propagates a network-level throw from fetch", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      await expect(api.getRuns()).rejects.toThrow("network down");
    });
  });

  describe("getRun", () => {
    it("GETs /runs/:id and returns run, artifacts, and events", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      fetchMock.mockResolvedValue(jsonResponse(payload));
      const result = await api.getRun("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1", { headers: {} });
      expect(result).toEqual(payload);
    });
  });

  describe("getRunSkills", () => {
    it("GETs /runs/:id/skills", async () => {
      const payload = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
      fetchMock.mockResolvedValue(jsonResponse(payload));
      const result = await api.getRunSkills("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/skills", { headers: {} });
      expect(result).toEqual(payload);
    });
  });

  describe("getArtifacts", () => {
    it("GETs /runs/:id/artifacts", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ artifacts: [] }));
      const result = await api.getArtifacts("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/artifacts", { headers: {} });
      expect(result).toEqual({ artifacts: [] });
    });
  });

  describe("getEvents", () => {
    it("GETs /runs/:id/events", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ events: [] }));
      const result = await api.getEvents("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/events", { headers: {} });
      expect(result).toEqual({ events: [] });
    });
  });

  describe("approvePlan", () => {
    it("POSTs with note when provided, including Content-Type header", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "approved" }));
      const result = await api.approvePlan("r1", "looks good");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
      expect(result).toEqual({ ok: true, state: "approved" });
    });

    it("sends note: undefined when no note is provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "approved" }));
      await api.approvePlan("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("rejectPlan", () => {
    it("defaults mode to 'iterate' and omits context when not given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "rejected" }));
      await api.rejectPlan("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: undefined, mode: "iterate" }),
      });
    });

    it("passes explicit context and mode through", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "rejected" }));
      await api.rejectPlan("r1", "needs rework", "fresh");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: "needs rework", mode: "fresh" }),
      });
    });
  });

  describe("reReviewPlan", () => {
    it("POSTs to re-review-plan with optional note", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      const result = await api.reReviewPlan("r1", "check again");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "check again" }),
      });
      expect(result).toEqual({ ok: true, runId: "r1" });
    });

    it("sends note: undefined when no note is provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      await api.reReviewPlan("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("revisePlan", () => {
    it("POSTs to revise-plan with optional note", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      await api.revisePlan("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("approveReview", () => {
    it("POSTs to approve-review with no body and no Content-Type header", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "approved" }));
      const result = await api.approveReview("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true, state: "approved" });
    });
  });

  describe("pauseRun", () => {
    it("POSTs to pause", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      const result = await api.pauseRun("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/pause", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true });
    });
  });

  describe("resumeRun", () => {
    it("POSTs to resume", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      const result = await api.resumeRun("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/resume", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true });
    });
  });

  describe("retryStage", () => {
    it("POSTs to retry and returns retrying flag", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "running", retrying: true }));
      const result = await api.retryStage("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/retry", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true, state: "running", retrying: true });
    });
  });

  describe("getActiveProcesses", () => {
    it("GETs /processes with no query when runId omitted", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses();
      expect(fetchMock).toHaveBeenCalledWith("/api/processes", { headers: {} });
    });

    it("GETs /processes?runId=... when runId given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=r1", { headers: {} });
    });
  });

  describe("getProcessOutput", () => {
    it("GETs /processes/:id/output", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processId: "p1", output: "log lines" }));
      const result = await api.getProcessOutput("p1");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
      expect(result).toEqual({ processId: "p1", output: "log lines" });
    });
  });

  describe("fetchPendingIssues", () => {
    it("GETs /linear/pending", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));
      const result = await api.fetchPendingIssues();
      expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
      expect(result).toEqual({ issues: [] });
    });
  });

  describe("ingestIssues", () => {
    it("POSTs the given issueIds array", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: ["i1"], skipped: [] }));
      const result = await api.ingestIssues(["i1", "i2"]);
      expect(fetchMock).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["i1", "i2"] }),
      });
      expect(result).toEqual({ ok: true, started: ["i1"], skipped: [] });
    });
  });

  describe("answerQuestions", () => {
    it("POSTs the answers array and returns the updated run", async () => {
      const answers = [{ questionId: "q1", answer: "yes" }];
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, run: { id: "r1" } }));
      const result = await api.answerQuestions("r1", answers);
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/answer-questions", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      expect(result).toEqual({ ok: true, run: { id: "r1" } });
    });
  });

  describe("sendChatMessage", () => {
    it("POSTs the message and returns reply plus durationMs", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ reply: "hi there", durationMs: 42 }));
      const result = await api.sendChatMessage("r1", "hello");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      });
      expect(result).toEqual({ reply: "hi there", durationMs: 42 });
    });

    it("rejects with the server error message on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "Runtime unavailable" }, false, 400));
      await expect(api.sendChatMessage("r1", "hello")).rejects.toThrow("Runtime unavailable");
    });
  });
});
