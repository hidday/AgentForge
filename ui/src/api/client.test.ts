import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client.ts";

function mockFetchOnce(response: { ok: boolean; status?: number; json: () => Promise<unknown> }) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response as Response);
}

describe("api client", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  describe("success responses", () => {
    it("getRuns performs a GET to /api/runs with no query string when state is omitted", async () => {
      mockFetchOnce({ ok: true, json: async () => ({ runs: [] }) });
      const result = await api.getRuns();
      expect(result).toEqual({ runs: [] });
      const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs");
      expect(options.headers).toEqual({});
    });

    it("getRuns appends ?state= when a state filter is passed", async () => {
      mockFetchOnce({ ok: true, json: async () => ({ runs: [] }) });
      await api.getRuns("Implementing");
      const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs?state=Implementing");
    });

    it("getRun fetches /api/runs/:id and returns the parsed body", async () => {
      const body = { run: { id: "r1" }, artifacts: [], events: [] };
      mockFetchOnce({ ok: true, json: async () => body });
      const result = await api.getRun("r1");
      expect(result).toEqual(body);
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/runs/r1");
    });

    it("approvePlan POSTs a JSON body and sets Content-Type", async () => {
      mockFetchOnce({ ok: true, json: async () => ({ ok: true, state: "Implementing" }) });
      await api.approvePlan("r1", "looks good");
      const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/r1/actions/approve-plan");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(options.body)).toEqual({ note: "looks good" });
    });

    it("approvePlan omits the note field when not provided (falsy coalesced to undefined)", async () => {
      mockFetchOnce({ ok: true, json: async () => ({ ok: true, state: "Implementing" }) });
      await api.approvePlan("r1");
      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsed = JSON.parse(options.body);
      expect(parsed).toEqual({});
    });

    it("rejectPlan defaults mode to 'iterate' when not supplied", async () => {
      mockFetchOnce({ ok: true, json: async () => ({ ok: true, state: "PlanRevision" }) });
      await api.rejectPlan("r1");
      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({ mode: "iterate" });
    });

    it("rejectPlan passes through an explicit context and mode", async () => {
      mockFetchOnce({ ok: true, json: async () => ({ ok: true, state: "PlanRevision" }) });
      await api.rejectPlan("r1", "needs changes", "fresh");
      const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({ context: "needs changes", mode: "fresh" });
    });

    it("approveReview and pauseRun/resumeRun/retryStage POST with no body", async () => {
      mockFetchOnce({ ok: true, json: async () => ({ ok: true, state: "AIReview" }) });
      await api.approveReview("r1");
      const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/r1/actions/approve-review");
      expect(options.method).toBe("POST");
      expect(options.body).toBeUndefined();
      expect(options.headers).toEqual({});
    });

    it("pauseRun, resumeRun, and retryStage POST to their respective action endpoints", async () => {
      mockFetchOnce({ ok: true, json: async () => ({ ok: true }) });
      await api.pauseRun("r1");
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)).toEqual([
        "/api/runs/r1/actions/pause",
        { headers: {}, method: "POST" },
      ]);

      mockFetchOnce({ ok: true, json: async () => ({ ok: true }) });
      await api.resumeRun("r1");
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)).toEqual([
        "/api/runs/r1/actions/resume",
        { headers: {}, method: "POST" },
      ]);

      mockFetchOnce({ ok: true, json: async () => ({ ok: true, state: "Implementing", retrying: true }) });
      const retryResult = await api.retryStage("r1");
      expect(retryResult).toEqual({ ok: true, state: "Implementing", retrying: true });
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)).toEqual([
        "/api/runs/r1/actions/retry",
        { headers: {}, method: "POST" },
      ]);
    });

    it("getActiveProcesses omits runId query param when not provided", async () => {
      mockFetchOnce({ ok: true, json: async () => ({ processes: [] }) });
      await api.getActiveProcesses();
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/processes");
    });

    it("getActiveProcesses includes ?runId= when provided", async () => {
      mockFetchOnce({ ok: true, json: async () => ({ processes: [] }) });
      await api.getActiveProcesses("r1");
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        "/api/processes?runId=r1",
      );
    });

    it("ingestIssues POSTs the issueIds array", async () => {
      mockFetchOnce({ ok: true, json: async () => ({ ok: true, started: ["i1"], skipped: [] }) });
      await api.ingestIssues(["i1", "i2"]);
      const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/linear/ingest");
      expect(JSON.parse(options.body)).toEqual({ issueIds: ["i1", "i2"] });
    });

    it("answerQuestions POSTs the answers array to the run's answer-questions action", async () => {
      mockFetchOnce({ ok: true, json: async () => ({ ok: true, run: {} }) });
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("r1", answers);
      const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/r1/actions/answer-questions");
      expect(JSON.parse(options.body)).toEqual({ answers });
    });

    it("sendChatMessage POSTs the message to the run's chat endpoint", async () => {
      mockFetchOnce({ ok: true, json: async () => ({ reply: "hi", durationMs: 5 }) });
      const result = await api.sendChatMessage("r1", "hello");
      expect(result).toEqual({ reply: "hi", durationMs: 5 });
      const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/r1/chat");
      expect(JSON.parse(options.body)).toEqual({ message: "hello" });
    });

    it("fetchPendingIssues, getRunSkills, getArtifacts, getEvents, getProcessOutput, reReviewPlan, revisePlan hit their documented paths", async () => {
      const calls: Array<[Promise<unknown>, string]> = [];
      mockFetchOnce({ ok: true, json: async () => ({ issues: [] }) });
      calls.push([api.fetchPendingIssues(), "/api/linear/pending"]);
      await calls[0][0];

      mockFetchOnce({ ok: true, json: async () => ({ injectedSkills: [], distillationDecision: null, distilledSkill: null }) });
      await api.getRunSkills("r1");
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe(
        "/api/runs/r1/skills",
      );

      mockFetchOnce({ ok: true, json: async () => ({ artifacts: [] }) });
      await api.getArtifacts("r1");
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe(
        "/api/runs/r1/artifacts",
      );

      mockFetchOnce({ ok: true, json: async () => ({ events: [] }) });
      await api.getEvents("r1");
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe(
        "/api/runs/r1/events",
      );

      mockFetchOnce({ ok: true, json: async () => ({ processId: "p1", output: "out" }) });
      await api.getProcessOutput("p1");
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe(
        "/api/processes/p1/output",
      );

      mockFetchOnce({ ok: true, json: async () => ({ ok: true, runId: "r1" }) });
      await api.reReviewPlan("r1", "note");
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe(
        "/api/runs/r1/actions/re-review-plan",
      );

      mockFetchOnce({ ok: true, json: async () => ({ ok: true, runId: "r1" }) });
      await api.revisePlan("r1");
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe(
        "/api/runs/r1/actions/revise-plan",
      );
    });
  });

  describe("error handling", () => {
    it("throws the server-provided error message when the response is not ok", async () => {
      mockFetchOnce({ ok: false, status: 400, json: async () => ({ error: "Bad input" }) });
      await expect(api.getRuns()).rejects.toThrow("Bad input");
    });

    it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
      mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error body fails to parse as JSON", async () => {
      mockFetchOnce({
        ok: false,
        status: 503,
        json: async () => {
          throw new SyntaxError("Unexpected end of input");
        },
      });
      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });
  });
});
