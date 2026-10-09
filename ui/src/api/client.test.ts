import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("request() behavior via getRuns", () => {
    it("sends a GET request without a Content-Type header and without a body", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ runs: [] }));
      vi.stubGlobal("fetch", fetchMock);

      const result = await api.getRuns();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs");
      expect(options.headers).toEqual({});
      expect(options.body).toBeUndefined();
      expect(result).toEqual({ runs: [] });
    });

    it("appends the state query param when provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ runs: [] }));
      vi.stubGlobal("fetch", fetchMock);

      await api.getRuns("Done");

      expect(fetchMock.mock.calls[0][0]).toBe("/api/runs?state=Done");
    });

    it("sends a Content-Type header and JSON body for POST requests", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, state: "Planning" }));
      vi.stubGlobal("fetch", fetchMock);

      await api.approvePlan("run-1", "looks good");

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/approve-plan");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({ "Content-Type": "application/json" });
      expect(options.body).toBe(JSON.stringify({ note: "looks good" }));
    });

    it("omits the note field (sends undefined) when no note is given", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, state: "Planning" }));
      vi.stubGlobal("fetch", fetchMock);

      await api.approvePlan("run-1");

      const [, options] = fetchMock.mock.calls[0];
      expect(JSON.parse(options.body as string)).toEqual({});
    });

    it("throws the server-provided error message for a non-ok response", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: "Run not found" }, false, 404));
      vi.stubGlobal("fetch", fetchMock);

      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to an 'HTTP <status>' message when the error body has no error field", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
      vi.stubGlobal("fetch", fetchMock);

      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to an 'HTTP <status>' message when the error body is not valid JSON", async () => {
      const res = {
        ok: false,
        status: 503,
        json: vi.fn().mockRejectedValue(new Error("invalid json")),
      } as unknown as Response;
      const fetchMock = vi.fn().mockResolvedValue(res);
      vi.stubGlobal("fetch", fetchMock);

      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 503");
    });

    it("propagates a network failure (rejected fetch)", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
      vi.stubGlobal("fetch", fetchMock);

      await expect(api.getRuns()).rejects.toThrow("network down");
    });
  });

  describe("individual endpoint wiring", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    });

    it("getRun calls the correct path", async () => {
      await api.getRun("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1", expect.objectContaining({}));
    });

    it("getRunSkills calls the correct path", async () => {
      await api.getRunSkills("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/skills", expect.anything());
    });

    it("getArtifacts calls the correct path", async () => {
      await api.getArtifacts("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/artifacts", expect.anything());
    });

    it("getEvents calls the correct path", async () => {
      await api.getEvents("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/events", expect.anything());
    });

    it("rejectPlan defaults mode to 'iterate' and omits empty context", async () => {
      await api.rejectPlan("run-1");
      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(JSON.parse(options.body as string)).toEqual({ mode: "iterate" });
    });

    it("rejectPlan sends explicit context and mode when provided", async () => {
      await api.rejectPlan("run-1", "needs rework", "fresh");
      const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/reject-plan");
      expect(JSON.parse(options.body as string)).toEqual({ context: "needs rework", mode: "fresh" });
    });

    it("reReviewPlan posts to the correct path with a note", async () => {
      await api.reReviewPlan("run-1", "re-check");
      const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/re-review-plan");
      expect(JSON.parse(options.body as string)).toEqual({ note: "re-check" });
    });

    it("reReviewPlan omits the note field when none is given", async () => {
      await api.reReviewPlan("run-1");
      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(JSON.parse(options.body as string)).toEqual({});
    });

    it("revisePlan posts to the correct path", async () => {
      await api.revisePlan("run-1");
      const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/revise-plan");
    });

    it("approveReview posts with no body", async () => {
      await api.approveReview("run-1");
      const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/approve-review");
      expect(options.method).toBe("POST");
      expect(options.body).toBeUndefined();
    });

    it("pauseRun posts to the pause action", async () => {
      await api.pauseRun("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/pause",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("resumeRun posts to the resume action", async () => {
      await api.resumeRun("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/resume",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("retryStage posts to the retry action", async () => {
      await api.retryStage("run-1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/retry",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("getActiveProcesses with no runId omits the query string", async () => {
      await api.getActiveProcesses();
      expect(fetch).toHaveBeenCalledWith("/api/processes", expect.anything());
    });

    it("getActiveProcesses with a runId appends the query string", async () => {
      await api.getActiveProcesses("run-1");
      expect(fetch).toHaveBeenCalledWith("/api/processes?runId=run-1", expect.anything());
    });

    it("getProcessOutput calls the correct path", async () => {
      await api.getProcessOutput("proc-1");
      expect(fetch).toHaveBeenCalledWith("/api/processes/proc-1/output", expect.anything());
    });

    it("fetchPendingIssues calls the linear pending endpoint", async () => {
      await api.fetchPendingIssues();
      expect(fetch).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
    });

    it("ingestIssues posts the issue ids", async () => {
      await api.ingestIssues(["a", "b"]);
      const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/linear/ingest");
      expect(JSON.parse(options.body as string)).toEqual({ issueIds: ["a", "b"] });
    });

    it("answerQuestions posts answers for the run", async () => {
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("run-1", answers);
      const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/answer-questions");
      expect(JSON.parse(options.body as string)).toEqual({ answers });
    });

    it("sendChatMessage posts the message to the run's chat endpoint", async () => {
      await api.sendChatMessage("run-1", "hello there");
      const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/chat");
      expect(JSON.parse(options.body as string)).toEqual({ message: "hello there" });
    });
  });
});
