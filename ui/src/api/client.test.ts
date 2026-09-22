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
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  describe("getRuns", () => {
    it("requests /api/runs with no query when state is omitted", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [{ id: "r1" }] }));
      const result = await api.getRuns();
      expect(fetchMock).toHaveBeenCalledWith("/api/runs", { headers: {} });
      expect(result).toEqual({ runs: [{ id: "r1" }] });
    });

    it("requests /api/runs?state=X when state is provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns("Planning");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs?state=Planning", { headers: {} });
    });

    it("throws the error message from the response body on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));
      await expect(api.getRuns()).rejects.toThrow("boom");
    });

    it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 503));
      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });

    it("falls back to 'HTTP <status>' when the error body is unparseable", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error("invalid json")),
      } as unknown as Response);
      await expect(api.getRuns()).rejects.toThrow("HTTP 502");
    });
  });

  describe("getRun", () => {
    it("requests /api/runs/:id and returns run detail", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      fetchMock.mockResolvedValue(jsonResponse(payload));
      const result = await api.getRun("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1", { headers: {} });
      expect(result).toEqual(payload);
    });

    it("throws on non-ok response with error body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "not found" }, false, 404));
      await expect(api.getRun("missing")).rejects.toThrow("not found");
    });
  });

  describe("getRunSkills", () => {
    it("requests /api/runs/:runId/skills", async () => {
      const payload = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
      fetchMock.mockResolvedValue(jsonResponse(payload));
      const result = await api.getRunSkills("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/skills", { headers: {} });
      expect(result).toEqual(payload);
    });

    it("throws fallback error on failure without error field", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.getRunSkills("r1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("getArtifacts", () => {
    it("requests /api/runs/:runId/artifacts", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ artifacts: [{ id: "a1" }] }));
      const result = await api.getArtifacts("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/artifacts", { headers: {} });
      expect(result).toEqual({ artifacts: [{ id: "a1" }] });
    });

    it("throws error message from body on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "denied" }, false, 403));
      await expect(api.getArtifacts("r1")).rejects.toThrow("denied");
    });
  });

  describe("getEvents", () => {
    it("requests /api/runs/:runId/events", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ events: [] }));
      const result = await api.getEvents("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/events", { headers: {} });
      expect(result).toEqual({ events: [] });
    });

    it("throws fallback error when body is unparseable", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("bad json")),
      } as unknown as Response);
      await expect(api.getEvents("r1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("approvePlan", () => {
    it("POSTs with the note in the body when provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
      const result = await api.approvePlan("r1", "looks good");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
      expect(result).toEqual({ ok: true, state: "Implementing" });
    });

    it("sends undefined note when note is omitted", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
      await api.approvePlan("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });

    it("throws the error message on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "cannot approve" }, false, 400));
      await expect(api.approvePlan("r1")).rejects.toThrow("cannot approve");
    });
  });

  describe("rejectPlan", () => {
    it("POSTs with context and mode defaulting to 'iterate'", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));
      await api.rejectPlan("r1", "needs work");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: "needs work", mode: "iterate" }),
      });
    });

    it("uses the provided mode when given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));
      await api.rejectPlan("r1", "start over", "fresh");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: "start over", mode: "fresh" }),
      });
    });

    it("sends undefined context when omitted", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));
      await api.rejectPlan("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: undefined, mode: "iterate" }),
      });
    });

    it("throws the error message on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "reject failed" }, false, 400));
      await expect(api.rejectPlan("r1")).rejects.toThrow("reject failed");
    });
  });

  describe("reReviewPlan", () => {
    it("POSTs with the note", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      const result = await api.reReviewPlan("r1", "please recheck");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "please recheck" }),
      });
      expect(result).toEqual({ ok: true, runId: "r1" });
    });

    it("throws fallback error when body has no error field", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.reReviewPlan("r1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("revisePlan", () => {
    it("POSTs with the note", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      const result = await api.revisePlan("r1", "revise this");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "revise this" }),
      });
      expect(result).toEqual({ ok: true, runId: "r1" });
    });

    it("throws the error message on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "revise failed" }, false, 400));
      await expect(api.revisePlan("r1")).rejects.toThrow("revise failed");
    });
  });

  describe("approveReview", () => {
    it("POSTs with no body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Done" }));
      const result = await api.approveReview("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true, state: "Done" });
    });

    it("throws fallback error on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.approveReview("r1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("pauseRun", () => {
    it("POSTs to /actions/pause", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      const result = await api.pauseRun("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/pause", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true });
    });

    it("throws the error message on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "cannot pause" }, false, 409));
      await expect(api.pauseRun("r1")).rejects.toThrow("cannot pause");
    });
  });

  describe("resumeRun", () => {
    it("POSTs to /actions/resume", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      const result = await api.resumeRun("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/resume", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true });
    });

    it("throws fallback error on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.resumeRun("r1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("retryStage", () => {
    it("POSTs to /actions/retry", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing", retrying: true }));
      const result = await api.retryStage("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/retry", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true, state: "Implementing", retrying: true });
    });

    it("throws the error message on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "retry failed" }, false, 400));
      await expect(api.retryStage("r1")).rejects.toThrow("retry failed");
    });
  });

  describe("getActiveProcesses", () => {
    it("requests /api/processes with no query when runId omitted", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      const result = await api.getActiveProcesses();
      expect(fetchMock).toHaveBeenCalledWith("/api/processes", { headers: {} });
      expect(result).toEqual({ processes: [] });
    });

    it("requests /api/processes?runId=X when provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=r1", { headers: {} });
    });

    it("throws fallback error on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.getActiveProcesses()).rejects.toThrow("HTTP 500");
    });
  });

  describe("getProcessOutput", () => {
    it("requests /api/processes/:processId/output", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processId: "p1", output: "log lines" }));
      const result = await api.getProcessOutput("p1");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
      expect(result).toEqual({ processId: "p1", output: "log lines" });
    });

    it("throws the error message on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "process gone" }, false, 404));
      await expect(api.getProcessOutput("p1")).rejects.toThrow("process gone");
    });
  });

  describe("fetchPendingIssues", () => {
    it("requests /api/linear/pending", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));
      const result = await api.fetchPendingIssues();
      expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
      expect(result).toEqual({ issues: [] });
    });

    it("throws fallback error when body is unparseable", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("bad json")),
      } as unknown as Response);
      await expect(api.fetchPendingIssues()).rejects.toThrow("HTTP 500");
    });
  });

  describe("ingestIssues", () => {
    it("POSTs the issueIds array", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: ["a"], skipped: [] }));
      const result = await api.ingestIssues(["a", "b"]);
      expect(fetchMock).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["a", "b"] }),
      });
      expect(result).toEqual({ ok: true, started: ["a"], skipped: [] });
    });

    it("throws the error message on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "ingest failed" }, false, 400));
      await expect(api.ingestIssues(["a"])).rejects.toThrow("ingest failed");
    });
  });

  describe("answerQuestions", () => {
    it("POSTs the answers array", async () => {
      const run = { id: "r1" };
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, run }));
      const answers = [{ questionId: "q1", answer: "yes" }];
      const result = await api.answerQuestions("r1", answers);
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/actions/answer-questions", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      expect(result).toEqual({ ok: true, run });
    });

    it("throws fallback error on failure without error field", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.answerQuestions("r1", [])).rejects.toThrow("HTTP 500");
    });
  });

  describe("sendChatMessage", () => {
    it("POSTs the message and returns the reply", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ reply: "hi there", durationMs: 42 }));
      const result = await api.sendChatMessage("r1", "hello");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      });
      expect(result).toEqual({ reply: "hi there", durationMs: 42 });
    });

    it("throws the error message from the response body on failure", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "chat failed" }, false, 500));
      await expect(api.sendChatMessage("r1", "hello")).rejects.toThrow("chat failed");
    });

    it("throws fallback error when body is unparseable", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("bad json")),
      } as unknown as Response);
      await expect(api.sendChatMessage("r1", "hello")).rejects.toThrow("HTTP 500");
    });
  });
});
