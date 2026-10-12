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

  describe("getRuns", () => {
    it("fetches without a query string when no state is given", async () => {
      const runs = [{ id: "r1" }];
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs }));

      const result = await api.getRuns();

      expect(fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
      expect(result).toEqual({ runs });
    });

    it("includes the state query param when given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));

      await api.getRuns("Executing");

      expect(fetch).toHaveBeenCalledWith("/api/runs?state=Executing", { headers: {} });
    });

    it("throws the server-provided error message on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "boom" }, false, 500),
      );

      await expect(api.getRuns()).rejects.toThrow("boom");
    });

    it("falls back to an HTTP status error when the body has no error field", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 503));

      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });

    it("falls back to an HTTP status error when the error body cannot be parsed", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.reject(new Error("not json")),
      } as unknown as Response);

      await expect(api.getRuns()).rejects.toThrow("HTTP 404");
    });

    it("propagates a network rejection", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

      await expect(api.getRuns()).rejects.toThrow("network down");
    });
  });

  describe("getRun", () => {
    it("requests the run detail endpoint and returns the parsed payload", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.getRun("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1", { headers: {} });
      expect(result).toEqual(payload);
    });

    it("rejects on a non-ok response", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "not found" }, false, 404),
      );

      await expect(api.getRun("missing")).rejects.toThrow("not found");
    });
  });

  describe("getRunSkills", () => {
    it("requests the run skills endpoint", async () => {
      const payload = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.getRunSkills("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/skills", { headers: {} });
      expect(result).toEqual(payload);
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ error: "no" }, false, 400));

      await expect(api.getRunSkills("r1")).rejects.toThrow("no");
    });
  });

  describe("getArtifacts", () => {
    it("requests artifacts for a run", async () => {
      const payload = { artifacts: [{ id: "a1" }] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.getArtifacts("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", { headers: {} });
      expect(result).toEqual(payload);
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));

      await expect(api.getArtifacts("r1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("getEvents", () => {
    it("requests events for a run", async () => {
      const payload = { events: [{ id: "e1" }] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.getEvents("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/events", { headers: {} });
      expect(result).toEqual(payload);
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));

      await expect(api.getEvents("r1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("approvePlan", () => {
    it("posts with the note when given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      const result = await api.approvePlan("r1", "looks good");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
      expect(result).toEqual({ ok: true, state: "x" });
    });

    it("sends undefined note when omitted", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.approvePlan("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ error: "denied" }, false, 403));

      await expect(api.approvePlan("r1")).rejects.toThrow("denied");
    });
  });

  describe("rejectPlan", () => {
    it("posts context and mode, defaulting mode to iterate", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.rejectPlan("r1", "needs work");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: "needs work", mode: "iterate" }),
      });
    });

    it("allows passing mode explicitly", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.rejectPlan("r1", "start over", "fresh");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: "start over", mode: "fresh" }),
      });
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));

      await expect(api.rejectPlan("r1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("reReviewPlan", () => {
    it("posts the note", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

      const result = await api.reReviewPlan("r1", "re-check");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "re-check" }),
      });
      expect(result).toEqual({ ok: true, runId: "r1" });
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));

      await expect(api.reReviewPlan("r1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("revisePlan", () => {
    it("posts the note", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

      const result = await api.revisePlan("r1", "revise it");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "revise it" }),
      });
      expect(result).toEqual({ ok: true, runId: "r1" });
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));

      await expect(api.revisePlan("r1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("approveReview", () => {
    it("posts with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      const result = await api.approveReview("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true, state: "x" });
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));

      await expect(api.approveReview("r1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("pauseRun", () => {
    it("posts with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

      const result = await api.pauseRun("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/pause", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true });
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));

      await expect(api.pauseRun("r1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("resumeRun", () => {
    it("posts with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

      const result = await api.resumeRun("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/resume", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true });
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));

      await expect(api.resumeRun("r1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("retryStage", () => {
    it("posts with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "x", retrying: true }),
      );

      const result = await api.retryStage("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/retry", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true, state: "x", retrying: true });
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));

      await expect(api.retryStage("r1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("getActiveProcesses", () => {
    it("fetches without a query string when no runId is given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));

      const result = await api.getActiveProcesses();

      expect(fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
      expect(result).toEqual({ processes: [] });
    });

    it("includes the runId query param when given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));

      await api.getActiveProcesses("r1");

      expect(fetch).toHaveBeenCalledWith("/api/processes?runId=r1", { headers: {} });
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));

      await expect(api.getActiveProcesses()).rejects.toThrow("HTTP 500");
    });
  });

  describe("getProcessOutput", () => {
    it("requests process output", async () => {
      const payload = { processId: "p1", output: "hello" };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.getProcessOutput("p1");

      expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
      expect(result).toEqual(payload);
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 404));

      await expect(api.getProcessOutput("p1")).rejects.toThrow("HTTP 404");
    });
  });

  describe("fetchPendingIssues", () => {
    it("requests pending linear issues", async () => {
      const payload = { issues: [{ id: "i1" }] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.fetchPendingIssues();

      expect(fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
      expect(result).toEqual(payload);
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));

      await expect(api.fetchPendingIssues()).rejects.toThrow("HTTP 500");
    });
  });

  describe("ingestIssues", () => {
    it("posts the issue ids", async () => {
      const payload = { ok: true, started: ["i1"], skipped: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.ingestIssues(["i1", "i2"]);

      expect(fetch).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["i1", "i2"] }),
      });
      expect(result).toEqual(payload);
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ error: "bad ids" }, false, 400));

      await expect(api.ingestIssues(["bad"])).rejects.toThrow("bad ids");
    });
  });

  describe("answerQuestions", () => {
    it("posts the answers", async () => {
      const payload = { ok: true, run: { id: "r1" } };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));
      const answers = [{ questionId: "q1", answer: "a1" }];

      const result = await api.answerQuestions("r1", answers);

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/answer-questions", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      expect(result).toEqual(payload);
    });

    it("rejects on failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ error: "bad" }, false, 400));

      await expect(api.answerQuestions("r1", [])).rejects.toThrow("bad");
    });
  });

  describe("sendChatMessage", () => {
    it("posts the chat message", async () => {
      const payload = { reply: "hi", durationMs: 42 };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.sendChatMessage("r1", "hello");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      });
      expect(result).toEqual(payload);
    });

    it("rejects on a network failure", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));

      await expect(api.sendChatMessage("r1", "hello")).rejects.toThrow("offline");
    });
  });
});
