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
    it("requests /api/runs with no query when no state filter is given", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [] }),
      );
      const result = await api.getRuns();
      expect(fetch).toHaveBeenCalledWith("/api/runs", expect.objectContaining({ headers: {} }));
      expect(result).toEqual({ runs: [] });
    });

    it("appends the state filter as a query string when provided", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [] }),
      );
      await api.getRuns("Done");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs?state=Done",
        expect.anything(),
      );
    });
  });

  describe("getRun", () => {
    it("requests the run detail endpoint and returns the parsed body", async () => {
      const body = { run: { id: "r1" }, artifacts: [], events: [] };
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse(body),
      );
      const result = await api.getRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1", expect.anything());
      expect(result).toEqual(body);
    });
  });

  describe("getRunSkills", () => {
    it("requests the run skills endpoint", async () => {
      const body = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse(body),
      );
      const result = await api.getRunSkills("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/skills", expect.anything());
      expect(result).toEqual(body);
    });
  });

  describe("getArtifacts", () => {
    it("requests the run artifacts endpoint", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ artifacts: [] }),
      );
      await api.getArtifacts("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", expect.anything());
    });
  });

  describe("getEvents", () => {
    it("requests the run events endpoint", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ events: [] }),
      );
      await api.getEvents("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/events", expect.anything());
    });
  });

  describe("approvePlan", () => {
    it("POSTs with a note when provided, setting the JSON content-type header", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Implementing" }),
      );
      await api.approvePlan("r1", "go ahead");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "go ahead" }),
      });
    });

    it("omits the note from the body when not provided", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Implementing" }),
      );
      await api.approvePlan("r1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/approve-plan",
        expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
      );
    });
  });

  describe("rejectPlan", () => {
    it("defaults mode to 'iterate' and omits empty context", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Planning" }),
      );
      await api.rejectPlan("r1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/reject-plan",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ context: undefined, mode: "iterate" }),
        }),
      );
    });

    it("passes through context and an explicit mode", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Planning" }),
      );
      await api.rejectPlan("r1", "needs work", "fresh");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/reject-plan",
        expect.objectContaining({
          body: JSON.stringify({ context: "needs work", mode: "fresh" }),
        }),
      );
    });
  });

  describe("reReviewPlan", () => {
    it("POSTs the note to the re-review-plan endpoint", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, runId: "r1" }),
      );
      await api.reReviewPlan("r1", "note");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/re-review-plan",
        expect.objectContaining({ body: JSON.stringify({ note: "note" }) }),
      );
    });

    it("sends undefined for an empty-string note", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, runId: "r1" }),
      );
      await api.reReviewPlan("r1", "");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/re-review-plan",
        expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
      );
    });
  });

  describe("revisePlan", () => {
    it("POSTs the note to the revise-plan endpoint", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, runId: "r1" }),
      );
      await api.revisePlan("r1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/revise-plan",
        expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
      );
    });
  });

  describe("approveReview", () => {
    it("POSTs with no body", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Done" }),
      );
      await api.approveReview("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
    });
  });

  describe("pauseRun / resumeRun / retryStage", () => {
    it("pauseRun POSTs to the pause endpoint", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true }),
      );
      await api.pauseRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/pause", {
        headers: {},
        method: "POST",
      });
    });

    it("resumeRun POSTs to the resume endpoint", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true }),
      );
      await api.resumeRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/resume", {
        headers: {},
        method: "POST",
      });
    });

    it("retryStage POSTs to the retry endpoint", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Implementing", retrying: true }),
      );
      await api.retryStage("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/retry", {
        headers: {},
        method: "POST",
      });
    });
  });

  describe("getActiveProcesses", () => {
    it("requests /api/processes with no query when runId is omitted", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ processes: [] }),
      );
      await api.getActiveProcesses();
      expect(fetch).toHaveBeenCalledWith("/api/processes", expect.anything());
    });

    it("appends the runId as a query string when provided", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ processes: [] }),
      );
      await api.getActiveProcesses("r1");
      expect(fetch).toHaveBeenCalledWith("/api/processes?runId=r1", expect.anything());
    });
  });

  describe("getProcessOutput", () => {
    it("requests the process output endpoint", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ processId: "p1", output: "hello" }),
      );
      const result = await api.getProcessOutput("p1");
      expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", expect.anything());
      expect(result).toEqual({ processId: "p1", output: "hello" });
    });
  });

  describe("fetchPendingIssues", () => {
    it("requests the linear pending issues endpoint", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ issues: [] }),
      );
      await api.fetchPendingIssues();
      expect(fetch).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
    });
  });

  describe("ingestIssues", () => {
    it("POSTs the selected issue ids", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, started: ["a"], skipped: [] }),
      );
      await api.ingestIssues(["a", "b"]);
      expect(fetch).toHaveBeenCalledWith("/api/linear/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueIds: ["a", "b"] }),
      });
    });
  });

  describe("answerQuestions", () => {
    it("POSTs the answers array", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, run: {} }),
      );
      const answers = [{ questionId: "q1", answer: "a1" }];
      await api.answerQuestions("r1", answers);
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/answer-questions",
        expect.objectContaining({ body: JSON.stringify({ answers }) }),
      );
    });
  });

  describe("sendChatMessage", () => {
    it("POSTs the chat message", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ reply: "hi", durationMs: 10 }),
      );
      await api.sendChatMessage("r1", "hello");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/chat",
        expect.objectContaining({ body: JSON.stringify({ message: "hello" }) }),
      );
    });
  });

  describe("error handling", () => {
    it("throws the server-provided error message on a non-ok response", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Run not found" }, false, 404),
      );
      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to a generic HTTP status message when the body has no error field", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({}, false, 500),
      );
      await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to a generic HTTP status message when the error body isn't valid JSON", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("not json")),
      } as unknown as Response);
      await expect(api.getRun("r1")).rejects.toThrow("HTTP 503");
    });
  });
});
