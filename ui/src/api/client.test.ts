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

  describe("request helper behavior (via getRuns)", () => {
    it("issues a GET with no body / no Content-Type header and resolves parsed JSON", async () => {
      const runs = [{ id: "r1" }];
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs }),
      );

      const result = await api.getRuns();

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs");
      expect(init.headers).toEqual({});
      expect(result).toEqual({ runs });
    });

    it("appends the state query param when provided", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [] }),
      );
      await api.getRuns("running");
      const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs?state=running");
    });

    it("sets Content-Type: application/json and sends a JSON body on POST-type calls", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "approved" }),
      );
      await api.approvePlan("run-1", "looks good");
      const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/approve-plan");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(init.body).toBe(JSON.stringify({ note: "looks good" }));
    });

    it("throws an Error using the parsed body's `error` field on a non-ok response", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Run not found" }, false, 404),
      );

      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to `HTTP <status>` when the error body has no `error` field", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({}, false, 500),
      );

      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to `HTTP <status>` when the error response body is not valid JSON", async () => {
      const res = {
        ok: false,
        status: 503,
        json: vi.fn().mockRejectedValue(new Error("invalid json")),
      } as unknown as Response;
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(res);

      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 503");
    });

    it("propagates a network failure (fetch rejection) as a rejected promise", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("network down"),
      );

      await expect(api.getRuns()).rejects.toThrow("network down");
    });
  });

  describe("endpoint wiring", () => {
    beforeEach(() => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({}),
      );
    });

    it("getRun builds the correct path", async () => {
      await api.getRun("run-1");
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        "/api/runs/run-1",
      );
    });

    it("getRunSkills builds the correct path", async () => {
      await api.getRunSkills("run-1");
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        "/api/runs/run-1/skills",
      );
    });

    it("getArtifacts builds the correct path", async () => {
      await api.getArtifacts("run-1");
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        "/api/runs/run-1/artifacts",
      );
    });

    it("getEvents builds the correct path", async () => {
      await api.getEvents("run-1");
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        "/api/runs/run-1/events",
      );
    });

    it("approvePlan sends undefined note when omitted", async () => {
      await api.approvePlan("run-1");
      const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(JSON.parse(init.body)).toEqual({ note: undefined });
    });

    it("rejectPlan defaults mode to 'iterate' and sends context/mode", async () => {
      await api.rejectPlan("run-1", "needs more detail");
      const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/reject-plan");
      expect(JSON.parse(init.body)).toEqual({ context: "needs more detail", mode: "iterate" });
    });

    it("rejectPlan passes an explicit mode through", async () => {
      await api.rejectPlan("run-1", undefined, "fresh");
      const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(JSON.parse(init.body)).toEqual({ context: undefined, mode: "fresh" });
    });

    it("reReviewPlan posts to the correct path with a note", async () => {
      await api.reReviewPlan("run-1", "re-review note");
      const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/re-review-plan");
      expect(JSON.parse(init.body)).toEqual({ note: "re-review note" });
    });

    it("revisePlan posts to the correct path with a note", async () => {
      await api.revisePlan("run-1", "revise note");
      const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/revise-plan");
      expect(JSON.parse(init.body)).toEqual({ note: "revise note" });
    });

    it("reReviewPlan sends undefined note when omitted", async () => {
      await api.reReviewPlan("run-1");
      const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(JSON.parse(init.body)).toEqual({ note: undefined });
    });

    it("revisePlan sends undefined note when omitted", async () => {
      await api.revisePlan("run-1");
      const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(JSON.parse(init.body)).toEqual({ note: undefined });
    });

    it("approveReview posts with no body", async () => {
      await api.approveReview("run-1");
      const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/approve-review");
      expect(init.method).toBe("POST");
      expect(init.body).toBeUndefined();
      expect(init.headers).toEqual({});
    });

    it("pauseRun posts to the correct path", async () => {
      await api.pauseRun("run-1");
      const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/pause");
      expect(init.method).toBe("POST");
    });

    it("resumeRun posts to the correct path", async () => {
      await api.resumeRun("run-1");
      const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/resume");
      expect(init.method).toBe("POST");
    });

    it("retryStage posts to the correct path", async () => {
      await api.retryStage("run-1");
      const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/retry");
      expect(init.method).toBe("POST");
    });

    it("getActiveProcesses without runId omits the query string", async () => {
      await api.getActiveProcesses();
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        "/api/processes",
      );
    });

    it("getActiveProcesses with runId appends the query string", async () => {
      await api.getActiveProcesses("run-1");
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        "/api/processes?runId=run-1",
      );
    });

    it("getProcessOutput builds the correct path", async () => {
      await api.getProcessOutput("proc-1");
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        "/api/processes/proc-1/output",
      );
    });

    it("fetchPendingIssues hits the linear/pending path", async () => {
      await api.fetchPendingIssues();
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        "/api/linear/pending",
      );
    });

    it("ingestIssues posts the issueIds array", async () => {
      await api.ingestIssues(["a", "b"]);
      const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/linear/ingest");
      expect(JSON.parse(init.body)).toEqual({ issueIds: ["a", "b"] });
    });

    it("answerQuestions posts the answers array", async () => {
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("run-1", answers);
      const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/answer-questions");
      expect(JSON.parse(init.body)).toEqual({ answers });
    });

    it("sendChatMessage posts the message and returns the reply shape", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ reply: "hi", durationMs: 12 }),
      );
      const result = await api.sendChatMessage("run-1", "hello");
      const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/chat");
      expect(JSON.parse(init.body)).toEqual({ message: "hello" });
      expect(result).toEqual({ reply: "hi", durationMs: 12 });
    });
  });
});
