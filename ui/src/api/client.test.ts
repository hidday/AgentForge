import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client.ts";

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

  // -------------------------------------------------------------------
  // Core request() behavior, exercised through api.getRuns
  // -------------------------------------------------------------------
  describe("request() core behavior", () => {
    it("resolves with the parsed JSON body on a successful response", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [{ id: "r1" }] }));
      const result = await api.getRuns();
      expect(result).toEqual({ runs: [{ id: "r1" }] });
    });

    it("does not set a Content-Type header when there is no body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns();
      const [, init] = fetchMock.mock.calls[0]!;
      expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    });

    it("sets a Content-Type: application/json header when a body is present", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.approvePlan("run-1", "note");
      const [, init] = fetchMock.mock.calls[0]!;
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );
    });

    it("throws the server-provided error message when the response is not ok", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: "Something went wrong" }, false, 400),
      );
      await expect(api.getRuns()).rejects.toThrow("Something went wrong");
    });

    it("falls back to 'HTTP <status>' when the error body has no 'error' field", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error body fails to parse as JSON", async () => {
      const res = {
        ok: false,
        status: 503,
        json: vi.fn().mockRejectedValue(new Error("not json")),
      } as unknown as Response;
      fetchMock.mockResolvedValue(res);
      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });

    it("propagates a network failure (fetch rejects)", async () => {
      fetchMock.mockRejectedValue(new Error("Network down"));
      await expect(api.getRuns()).rejects.toThrow("Network down");
    });
  });

  // -------------------------------------------------------------------
  // Individual endpoints: URL / method / body shape
  // -------------------------------------------------------------------
  describe("getRuns", () => {
    it("requests /runs with no query string when state is omitted", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns();
      expect(fetchMock).toHaveBeenCalledWith("/api/runs", expect.any(Object));
    });

    it("appends ?state= when a state filter is given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
      await api.getRuns("Done");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs?state=Done", expect.any(Object));
    });
  });

  describe("getRun", () => {
    it("requests /runs/:id and returns run/artifacts/events", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      fetchMock.mockResolvedValue(jsonResponse(payload));
      const result = await api.getRun("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1", expect.any(Object));
      expect(result).toEqual(payload);
    });
  });

  describe("getRunSkills", () => {
    it("requests /runs/:id/skills", async () => {
      const payload = {
        injectedSkills: [],
        distillationDecision: null,
        distilledSkill: null,
      };
      fetchMock.mockResolvedValue(jsonResponse(payload));
      const result = await api.getRunSkills("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/skills", expect.any(Object));
      expect(result).toEqual(payload);
    });
  });

  describe("getArtifacts", () => {
    it("requests /runs/:id/artifacts", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ artifacts: [] }));
      await api.getArtifacts("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/artifacts", expect.any(Object));
    });
  });

  describe("getEvents", () => {
    it("requests /runs/:id/events", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ events: [] }));
      await api.getEvents("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/events", expect.any(Object));
    });
  });

  describe("approvePlan", () => {
    it("POSTs with the note when provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.approvePlan("r1", "looks good");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/approve-plan");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ note: "looks good" });
    });

    it("sends note: undefined when no note is given (falsy fallback)", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.approvePlan("r1");
      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init.body as string)).toEqual({});
    });

    it("treats an empty string note as falsy too", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.approvePlan("r1", "");
      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init.body as string)).toEqual({});
    });
  });

  describe("rejectPlan", () => {
    it("defaults mode to 'iterate' and omits context when not given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.rejectPlan("r1");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/reject-plan");
      expect(JSON.parse(init.body as string)).toEqual({ mode: "iterate" });
    });

    it("passes through an explicit context and mode", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.rejectPlan("r1", "needs rework", "fresh");
      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init.body as string)).toEqual({
        context: "needs rework",
        mode: "fresh",
      });
    });
  });

  describe("reReviewPlan", () => {
    it("POSTs to the re-review-plan endpoint with an optional note", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      await api.reReviewPlan("r1", "re-check this");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/re-review-plan");
      expect(JSON.parse(init.body as string)).toEqual({ note: "re-check this" });
    });

    it("omits the note when not provided", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      await api.reReviewPlan("r1");
      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init.body as string)).toEqual({});
    });
  });

  describe("revisePlan", () => {
    it("POSTs to the revise-plan endpoint with an optional note", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
      await api.revisePlan("r1", "please revise");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/revise-plan");
      expect(JSON.parse(init.body as string)).toEqual({ note: "please revise" });
    });
  });

  describe("approveReview", () => {
    it("POSTs to approve-review with no body", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
      await api.approveReview("r1");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/approve-review");
      expect(init.method).toBe("POST");
      expect(init.body).toBeUndefined();
    });
  });

  describe("pauseRun / resumeRun / retryStage", () => {
    it("pauseRun POSTs to the pause endpoint", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.pauseRun("r1");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs/r1/actions/pause",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("resumeRun POSTs to the resume endpoint", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await api.resumeRun("r1");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs/r1/actions/resume",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("retryStage POSTs to the retry endpoint", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x", retrying: true }));
      await api.retryStage("r1");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs/r1/actions/retry",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("getActiveProcesses", () => {
    it("requests /processes with no query string when runId is omitted", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses();
      expect(fetchMock).toHaveBeenCalledWith("/api/processes", expect.any(Object));
    });

    it("appends ?runId= when given", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
      await api.getActiveProcesses("r1");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=r1", expect.any(Object));
    });
  });

  describe("getProcessOutput", () => {
    it("requests /processes/:id/output", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ processId: "p1", output: "log" }));
      const result = await api.getProcessOutput("p1");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/output", expect.any(Object));
      expect(result).toEqual({ processId: "p1", output: "log" });
    });
  });

  describe("fetchPendingIssues", () => {
    it("requests /linear/pending", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));
      await api.fetchPendingIssues();
      expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", expect.any(Object));
    });
  });

  describe("ingestIssues", () => {
    it("POSTs the issueIds array", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: [], skipped: [] }));
      await api.ingestIssues(["a", "b"]);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/linear/ingest");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ issueIds: ["a", "b"] });
    });
  });

  describe("answerQuestions", () => {
    it("POSTs the answers array", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, run: {} }));
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("r1", answers);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/answer-questions");
      expect(JSON.parse(init.body as string)).toEqual({ answers });
    });
  });

  describe("sendChatMessage", () => {
    it("POSTs the chat message and returns the reply", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ reply: "hi there", durationMs: 42 }),
      );
      const result = await api.sendChatMessage("r1", "hello");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/chat");
      expect(JSON.parse(init.body as string)).toEqual({ message: "hello" });
      expect(result).toEqual({ reply: "hi there", durationMs: 42 });
    });
  });
});
