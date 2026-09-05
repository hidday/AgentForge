import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function errorJsonRejects(status: number) {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error("not json")),
  } as unknown as Response;
}

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  describe("request() shared behavior", () => {
    it("issues a GET without a Content-Type header when there is no body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns();

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs",
        expect.objectContaining({ headers: {} }),
      );
    });

    it("sets Content-Type: application/json when a body is present", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.approvePlan("run-1", "looks good");

      const [, options] = fetchMock.mock.calls[0]!;
      expect((options as RequestInit).headers).toEqual({
        "Content-Type": "application/json",
      });
      expect((options as RequestInit).body).toBe(
        JSON.stringify({ note: "looks good" }),
      );
    });

    it("throws the server-provided error message on a non-ok JSON response", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "Run not found" }, false, 404));
      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error body isn't valid JSON", async () => {
      fetchMock.mockResolvedValue(errorJsonRejects(503));
      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 503");
    });

    it("propagates a network failure (fetch rejecting)", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      await expect(api.getRun("run-1")).rejects.toThrow("network down");
    });

    it("resolves with the parsed JSON body on success", async () => {
      const payload = { run: { id: "run-1" }, artifacts: [], events: [] };
      fetchMock.mockResolvedValue(jsonResponse(payload));
      await expect(api.getRun("run-1")).resolves.toEqual(payload);
    });
  });

  describe("query-param branches", () => {
    it("getRuns() omits the query string when no state is given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns();
      expect(fetchMock).toHaveBeenCalledWith("/api/runs", expect.anything());
    });

    it("getRuns(state) appends ?state=<state>", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns("planning");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs?state=planning", expect.anything());
    });

    it("getActiveProcesses() omits the query string when no runId is given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses();
      expect(fetchMock).toHaveBeenCalledWith("/api/processes", expect.anything());
    });

    it("getActiveProcesses(runId) appends ?runId=<runId>", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses("run-9");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=run-9", expect.anything());
    });
  });

  describe("simple GET endpoints", () => {
    it("getRunSkills", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
      );
      await api.getRunSkills("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/skills", expect.anything());
    });

    it("getArtifacts", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ artifacts: [] }));
      await api.getArtifacts("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/artifacts", expect.anything());
    });

    it("getEvents", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ events: [] }));
      await api.getEvents("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/events", expect.anything());
    });

    it("getProcessOutput", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processId: "p1", output: "hi" }));
      await api.getProcessOutput("p1");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/output", expect.anything());
    });

    it("fetchPendingIssues", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));
      await api.fetchPendingIssues();
      expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
    });
  });

  describe("POST endpoints with optional body fields", () => {
    it("approvePlan without a note sends note: undefined", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "approved" }));
      await api.approvePlan("run-1");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/approve-plan");
      expect((options as RequestInit).method).toBe("POST");
      expect((options as RequestInit).body).toBe(JSON.stringify({ note: undefined }));
    });

    it("rejectPlan defaults mode to 'iterate' and omits empty context", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "rejected" }));
      await api.rejectPlan("run-1", "");
      const [, options] = fetchMock.mock.calls[0]!;
      expect((options as RequestInit).body).toBe(
        JSON.stringify({ context: undefined, mode: "iterate" }),
      );
    });

    it("rejectPlan passes through an explicit context and mode", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "rejected" }));
      await api.rejectPlan("run-1", "needs work", "fresh");
      const [, options] = fetchMock.mock.calls[0]!;
      expect((options as RequestInit).body).toBe(
        JSON.stringify({ context: "needs work", mode: "fresh" }),
      );
    });

    it("reReviewPlan with a note", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.reReviewPlan("run-1", "note");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/re-review-plan");
      expect((options as RequestInit).method).toBe("POST");
      expect((options as RequestInit).body).toBe(JSON.stringify({ note: "note" }));
    });

    it("reReviewPlan without a note sends note: undefined", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.reReviewPlan("run-1");
      const [, options] = fetchMock.mock.calls[0]!;
      expect((options as RequestInit).body).toBe(JSON.stringify({ note: undefined }));
    });

    it("revisePlan without a note sends note: undefined", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.revisePlan("run-1");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/revise-plan");
      expect((options as RequestInit).method).toBe("POST");
      expect((options as RequestInit).body).toBe(JSON.stringify({ note: undefined }));
    });

    it("revisePlan with a note", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
      await api.revisePlan("run-1", "please adjust");
      const [, options] = fetchMock.mock.calls[0]!;
      expect((options as RequestInit).body).toBe(
        JSON.stringify({ note: "please adjust" }),
      );
    });

    it("answerQuestions serializes the answers array", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, run: {} }));
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("run-1", answers);
      const [, options] = fetchMock.mock.calls[0]!;
      expect((options as RequestInit).body).toBe(JSON.stringify({ answers }));
    });

    it("sendChatMessage", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ reply: "hi", durationMs: 1 }));
      await api.sendChatMessage("run-1", "hello");
      const [, options] = fetchMock.mock.calls[0]!;
      expect((options as RequestInit).body).toBe(JSON.stringify({ message: "hello" }));
    });

    it("ingestIssues", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: [], skipped: [] }));
      await api.ingestIssues(["a", "b"]);
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/linear/ingest");
      expect((options as RequestInit).body).toBe(JSON.stringify({ issueIds: ["a", "b"] }));
    });
  });

  describe("bodyless POST endpoints", () => {
    it("approveReview does not set Content-Type", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "approved" }));
      await api.approveReview("run-1");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/approve-review");
      expect((options as RequestInit).headers).toEqual({});
      expect((options as RequestInit).method).toBe("POST");
    });

    it("pauseRun", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.pauseRun("run-1");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/pause",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("resumeRun", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.resumeRun("run-1");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/resume",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("retryStage", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x", retrying: true }));
      await api.retryStage("run-1");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/retry",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
