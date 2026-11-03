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
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  describe("request() error handling (via getRuns)", () => {
    it("throws the server's error message on a non-2xx JSON response", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "Something broke" }, false, 400));
      await expect(api.getRuns()).rejects.toThrow("Something broke");
    });

    it("falls back to an HTTP status message when the error body has no 'error' field", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("falls back to an HTTP status message when the error body is not valid JSON", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        json: vi.fn().mockRejectedValue(new Error("not json")),
      } as unknown as Response);
      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });

    it("propagates a network-level rejection", async () => {
      fetchMock.mockRejectedValue(new Error("Network down"));
      await expect(api.getRuns()).rejects.toThrow("Network down");
    });

    it("does not set Content-Type when there is no request body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns();
      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers).toEqual({});
    });

    it("sets Content-Type: application/json when a body is sent", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Planning" }));
      await api.approvePlan("run-1");
      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
    });
  });

  describe("getRuns", () => {
    it("requests /api/runs with no query string when unfiltered", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      const result = await api.getRuns();
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs",
        expect.objectContaining({ headers: {} }),
      );
      expect(result).toEqual({ runs: [] });
    });

    it("appends ?state= when a filter is given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns("Planning");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs?state=Planning", expect.anything());
    });
  });

  describe("getRun", () => {
    it("requests /api/runs/:id and returns the parsed run detail", async () => {
      const body = { run: { id: "r1" }, artifacts: [], events: [] };
      fetchMock.mockResolvedValue(jsonResponse(body));
      const result = await api.getRun("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1", expect.anything());
      expect(result).toEqual(body);
    });
  });

  describe("getRunSkills", () => {
    it("requests /api/runs/:id/skills", async () => {
      const body = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
      fetchMock.mockResolvedValue(jsonResponse(body));
      const result = await api.getRunSkills("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/skills", expect.anything());
      expect(result).toEqual(body);
    });
  });

  describe("getArtifacts", () => {
    it("requests /api/runs/:id/artifacts", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ artifacts: [] }));
      const result = await api.getArtifacts("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/artifacts", expect.anything());
      expect(result).toEqual({ artifacts: [] });
    });
  });

  describe("getEvents", () => {
    it("requests /api/runs/:id/events", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ events: [] }));
      const result = await api.getEvents("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/events", expect.anything());
      expect(result).toEqual({ events: [] });
    });
  });

  describe("approvePlan", () => {
    it("POSTs with a note when given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
      await api.approvePlan("r1", "looks good");
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/r1/actions/approve-plan");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ note: "looks good" });
    });

    it("omits the note field when not given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
      await api.approvePlan("r1");
      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({});
    });
  });

  describe("rejectPlan", () => {
    it("defaults mode to 'iterate' and omits context when not given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));
      await api.rejectPlan("r1");
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/r1/actions/reject-plan");
      expect(JSON.parse(init.body)).toEqual({ mode: "iterate" });
    });

    it("sends the given context and mode", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));
      await api.rejectPlan("r1", "needs more detail", "fresh");
      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ context: "needs more detail", mode: "fresh" });
    });
  });

  describe("reReviewPlan", () => {
    it("POSTs to the re-review-plan action with an optional note", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      await api.reReviewPlan("r1", "re-check this");
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/r1/actions/re-review-plan");
      expect(JSON.parse(init.body)).toEqual({ note: "re-check this" });
    });

    it("omits the note field when not given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      await api.reReviewPlan("r1");
      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({});
    });
  });

  describe("revisePlan", () => {
    it("POSTs to the revise-plan action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      await api.revisePlan("r1");
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/r1/actions/revise-plan");
      expect(JSON.parse(init.body)).toEqual({});
    });
  });

  describe("approveReview", () => {
    it("POSTs to the approve-review action with no body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Done" }));
      await api.approveReview("r1");
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/r1/actions/approve-review");
      expect(init.method).toBe("POST");
      expect(init.body).toBeUndefined();
    });
  });

  describe("pauseRun / resumeRun / retryStage", () => {
    it("pauseRun POSTs to the pause action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.pauseRun("r1");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs/r1/actions/pause",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("resumeRun POSTs to the resume action", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.resumeRun("r1");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs/r1/actions/resume",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("retryStage POSTs to the retry action and returns retrying state", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing", retrying: true }));
      const result = await api.retryStage("r1");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs/r1/actions/retry",
        expect.objectContaining({ method: "POST" }),
      );
      expect(result.retrying).toBe(true);
    });
  });

  describe("getActiveProcesses", () => {
    it("requests /api/processes without a query string when no runId given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses();
      expect(fetchMock).toHaveBeenCalledWith("/api/processes", expect.anything());
    });

    it("appends ?runId= when a runId is given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=r1", expect.anything());
    });
  });

  describe("getProcessOutput", () => {
    it("requests /api/processes/:id/output", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processId: "p1", output: "hi" }));
      const result = await api.getProcessOutput("p1");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/output", expect.anything());
      expect(result).toEqual({ processId: "p1", output: "hi" });
    });
  });

  describe("fetchPendingIssues", () => {
    it("requests /api/linear/pending", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));
      const result = await api.fetchPendingIssues();
      expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
      expect(result).toEqual({ issues: [] });
    });
  });

  describe("ingestIssues", () => {
    it("POSTs the issueIds array to /api/linear/ingest", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: ["a"], skipped: [] }));
      await api.ingestIssues(["a", "b"]);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/linear/ingest");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ issueIds: ["a", "b"] });
    });
  });

  describe("answerQuestions", () => {
    it("POSTs answers to the answer-questions action", async () => {
      const run = { id: "r1" };
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, run }));
      const answers = [{ questionId: "q1", answer: "yes" }];
      const result = await api.answerQuestions("r1", answers);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/r1/actions/answer-questions");
      expect(JSON.parse(init.body)).toEqual({ answers });
      expect(result.run).toEqual(run);
    });
  });

  describe("sendChatMessage", () => {
    it("POSTs the message to the run's chat endpoint", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ reply: "hi there", durationMs: 42 }));
      const result = await api.sendChatMessage("r1", "hello agent");
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/r1/chat");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ message: "hello agent" });
      expect(result).toEqual({ reply: "hi there", durationMs: 42 });
    });
  });
});
