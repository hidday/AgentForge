import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getRuns", () => {
    it("requests /api/runs with no query when state is omitted", async () => {
      const runs = [{ id: "r1" }];
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs }));

      const result = await api.getRuns();

      expect(fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
      expect(result).toEqual({ runs });
    });

    it("requests /api/runs?state=... when state is provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));

      await api.getRuns("Active");

      expect(fetch).toHaveBeenCalledWith("/api/runs?state=Active", { headers: {} });
    });
  });

  describe("getRun", () => {
    it("fetches a single run by id", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.getRun("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1", { headers: {} });
      expect(result).toEqual(payload);
    });
  });

  describe("getRunSkills", () => {
    it("fetches skills for a run", async () => {
      const payload = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.getRunSkills("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/skills", { headers: {} });
      expect(result).toEqual(payload);
    });
  });

  describe("getArtifacts", () => {
    it("fetches artifacts for a run", async () => {
      const payload = { artifacts: [{ id: "a1" }] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.getArtifacts("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", { headers: {} });
      expect(result).toEqual(payload);
    });
  });

  describe("getEvents", () => {
    it("fetches events for a run", async () => {
      const payload = { events: [{ id: "e1" }] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.getEvents("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/events", { headers: {} });
      expect(result).toEqual(payload);
    });
  });

  describe("approvePlan", () => {
    it("posts with note when provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "X" }));

      const result = await api.approvePlan("r1", "looks good");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
      expect(result).toEqual({ ok: true, state: "X" });
    });

    it("sends undefined note when omitted", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "X" }));

      await api.approvePlan("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("rejectPlan", () => {
    it("defaults mode to iterate", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "X" }));

      await api.rejectPlan("r1", "needs work");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: "needs work", mode: "iterate" }),
      });
    });

    it("passes through an explicit fresh mode and omitted context", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "X" }));

      await api.rejectPlan("r1", undefined, "fresh");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: undefined, mode: "fresh" }),
      });
    });
  });

  describe("reReviewPlan", () => {
    it("posts with optional note", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

      const result = await api.reReviewPlan("r1", "note");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "note" }),
      });
      expect(result).toEqual({ ok: true, runId: "r1" });
    });
  });

  describe("revisePlan", () => {
    it("posts with optional note", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

      const result = await api.revisePlan("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
      expect(result).toEqual({ ok: true, runId: "r1" });
    });
  });

  describe("approveReview", () => {
    it("posts with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "X" }));

      const result = await api.approveReview("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true, state: "X" });
    });
  });

  describe("pauseRun / resumeRun / retryStage", () => {
    it("pauseRun posts to pause endpoint", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
      await api.pauseRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/pause", {
        headers: {},
        method: "POST",
      });
    });

    it("resumeRun posts to resume endpoint", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
      await api.resumeRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/resume", {
        headers: {},
        method: "POST",
      });
    });

    it("retryStage posts to retry endpoint and returns body", async () => {
      const payload = { ok: true, state: "Executing", retrying: true };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));
      const result = await api.retryStage("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/retry", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual(payload);
    });
  });

  describe("getActiveProcesses", () => {
    it("requests without query when runId omitted", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses();
      expect(fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
    });

    it("requests with runId query when provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses("r1");
      expect(fetch).toHaveBeenCalledWith("/api/processes?runId=r1", { headers: {} });
    });
  });

  describe("getProcessOutput", () => {
    it("fetches output for a process", async () => {
      const payload = { processId: "p1", output: "log lines" };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));
      const result = await api.getProcessOutput("p1");
      expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
      expect(result).toEqual(payload);
    });
  });

  describe("fetchPendingIssues", () => {
    it("fetches pending linear issues", async () => {
      const payload = { issues: [{ id: "i1", title: "t", description: "d", state: "Todo", labels: [], priority: 1 }] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));
      const result = await api.fetchPendingIssues();
      expect(fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
      expect(result).toEqual(payload);
    });
  });

  describe("ingestIssues", () => {
    it("posts issue ids and returns started/skipped", async () => {
      const payload = { ok: true, started: ["i1"], skipped: ["i2"] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));
      const result = await api.ingestIssues(["i1", "i2"]);
      expect(fetch).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["i1", "i2"] }),
      });
      expect(result).toEqual(payload);
    });
  });

  describe("answerQuestions", () => {
    it("posts answers and returns the updated run", async () => {
      const payload = { ok: true, run: { id: "r1" } };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));
      const answers = [{ questionId: "q1", answer: "yes" }];

      const result = await api.answerQuestions("r1", answers);

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/answer-questions", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      expect(result).toEqual(payload);
    });

    it("propagates the server error message when the request fails", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Unrecognised questionId" }, false, 400),
      );

      await expect(api.answerQuestions("r1", [])).rejects.toThrow("Unrecognised questionId");
    });
  });

  describe("sendChatMessage", () => {
    it("posts a chat message and returns the reply", async () => {
      const payload = { reply: "hello", durationMs: 42 };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.sendChatMessage("r1", "hi");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "hi" }),
      });
      expect(result).toEqual(payload);
    });
  });

  describe("error handling", () => {
    it("throws the HTTP status fallback message when the error body has no error field", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 503));

      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });

    it("throws the HTTP status fallback message when the error body cannot be parsed as JSON", async () => {
      const res = {
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error("not json")),
      } as unknown as Response;
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res);

      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("propagates a network error thrown by fetch itself", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(api.getRuns()).rejects.toThrow("Failed to fetch");
    });
  });
});
