import { describe, it, expect, beforeEach, vi } from "vitest";
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

  describe("getRuns", () => {
    it("requests the runs list with no query when no state is given", async () => {
      const runs = [{ id: "r1" }];
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({ runs }),
      );

      const result = await api.getRuns();

      expect(fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
      expect(result).toEqual({ runs });
    });

    it("appends the state query param when a state is given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({ runs: [] }),
      );

      await api.getRuns("running");

      expect(fetch).toHaveBeenCalledWith("/api/runs?state=running", {
        headers: {},
      });
    });
  });

  describe("getRun", () => {
    it("fetches a single run by id", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.getRun("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1", { headers: {} });
      expect(result).toEqual(payload);
    });
  });

  describe("getRunSkills", () => {
    it("fetches skills for a run", async () => {
      const payload = {
        injectedSkills: [],
        distillationDecision: null,
        distilledSkill: null,
      };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.getRunSkills("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/skills", {
        headers: {},
      });
      expect(result).toEqual(payload);
    });
  });

  describe("getArtifacts", () => {
    it("fetches artifacts for a run", async () => {
      const payload = { artifacts: [{ id: "a1" }] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.getArtifacts("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", {
        headers: {},
      });
      expect(result).toEqual(payload);
    });
  });

  describe("getEvents", () => {
    it("fetches events for a run", async () => {
      const payload = { events: [{ id: "e1" }] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.getEvents("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/events", {
        headers: {},
      });
      expect(result).toEqual(payload);
    });
  });

  describe("approvePlan", () => {
    it("posts a note when provided", async () => {
      const payload = { ok: true, state: "approved" };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.approvePlan("r1", "looks good");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
      expect(result).toEqual(payload);
    });

    it("sends undefined note when omitted", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({ ok: true, state: "approved" }),
      );

      await api.approvePlan("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("rejectPlan", () => {
    it("posts context and mode when provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({ ok: true, state: "rejected" }),
      );

      await api.rejectPlan("r1", "needs work", "fresh");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: "needs work", mode: "fresh" }),
      });
    });

    it("defaults mode to iterate and context to undefined", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({ ok: true, state: "rejected" }),
      );

      await api.rejectPlan("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: undefined, mode: "iterate" }),
      });
    });
  });

  describe("reReviewPlan", () => {
    it("posts a note when provided", async () => {
      const payload = { ok: true, runId: "r1" };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.reReviewPlan("r1", "please recheck");

      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/re-review-plan",
        {
          headers: { "Content-Type": "application/json" },
          method: "POST",
          body: JSON.stringify({ note: "please recheck" }),
        },
      );
      expect(result).toEqual(payload);
    });

    it("sends undefined note when omitted", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({ ok: true, runId: "r1" }),
      );

      await api.reReviewPlan("r1");

      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/re-review-plan",
        {
          headers: { "Content-Type": "application/json" },
          method: "POST",
          body: JSON.stringify({ note: undefined }),
        },
      );
    });
  });

  describe("revisePlan", () => {
    it("posts a note when provided", async () => {
      const payload = { ok: true, runId: "r1" };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.revisePlan("r1", "revise please");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "revise please" }),
      });
      expect(result).toEqual(payload);
    });

    it("sends undefined note when omitted", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({ ok: true, runId: "r1" }),
      );

      await api.revisePlan("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("approveReview", () => {
    it("posts with no body", async () => {
      const payload = { ok: true, state: "approved" };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.approveReview("r1");

      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/approve-review",
        { headers: {}, method: "POST" },
      );
      expect(result).toEqual(payload);
    });
  });

  describe("pauseRun", () => {
    it("posts with no body", async () => {
      const payload = { ok: true };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.pauseRun("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/pause", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual(payload);
    });
  });

  describe("resumeRun", () => {
    it("posts with no body", async () => {
      const payload = { ok: true };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.resumeRun("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/resume", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual(payload);
    });
  });

  describe("retryStage", () => {
    it("posts with no body", async () => {
      const payload = { ok: true, state: "running", retrying: true };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.retryStage("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/retry", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual(payload);
    });
  });

  describe("getActiveProcesses", () => {
    it("requests all processes when no runId is given", async () => {
      const payload = { processes: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.getActiveProcesses();

      expect(fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
      expect(result).toEqual(payload);
    });

    it("appends runId query param when given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({ processes: [] }),
      );

      await api.getActiveProcesses("r1");

      expect(fetch).toHaveBeenCalledWith("/api/processes?runId=r1", {
        headers: {},
      });
    });
  });

  describe("getProcessOutput", () => {
    it("fetches output for a process", async () => {
      const payload = { processId: "p1", output: "hello" };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.getProcessOutput("p1");

      expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", {
        headers: {},
      });
      expect(result).toEqual(payload);
    });
  });

  describe("fetchPendingIssues", () => {
    it("fetches pending linear issues", async () => {
      const payload = { issues: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.fetchPendingIssues();

      expect(fetch).toHaveBeenCalledWith("/api/linear/pending", {
        headers: {},
      });
      expect(result).toEqual(payload);
    });
  });

  describe("ingestIssues", () => {
    it("posts the issue ids", async () => {
      const payload = { ok: true, started: ["a"], skipped: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.ingestIssues(["a", "b"]);

      expect(fetch).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["a", "b"] }),
      });
      expect(result).toEqual(payload);
    });
  });

  describe("answerQuestions", () => {
    it("posts the answers array", async () => {
      const payload = { ok: true, run: { id: "r1" } };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const answers = [{ questionId: "q1", answer: "yes" }];
      const result = await api.answerQuestions("r1", answers);

      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/answer-questions",
        {
          headers: { "Content-Type": "application/json" },
          method: "POST",
          body: JSON.stringify({ answers }),
        },
      );
      expect(result).toEqual(payload);
    });
  });

  describe("sendChatMessage", () => {
    it("posts the chat message", async () => {
      const payload = { reply: "hi there", durationMs: 42 };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse(payload),
      );

      const result = await api.sendChatMessage("r1", "hello");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      });
      expect(result).toEqual(payload);
    });
  });

  describe("error handling", () => {
    it("throws the server-provided error message on non-ok responses", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({ error: "run not found" }, false, 404),
      );

      await expect(api.getRun("missing")).rejects.toThrow("run not found");
    });

    it("falls back to an HTTP status message when the error body has no error field", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({}, false, 500),
      );

      await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to an HTTP status message when the error body cannot be parsed as JSON", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("invalid json")),
      } as unknown as Response);

      await expect(api.getRun("r1")).rejects.toThrow("HTTP 503");
    });

    it("propagates a network-level rejection", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("network down"),
      );

      await expect(api.getRuns()).rejects.toThrow("network down");
    });
  });
});
