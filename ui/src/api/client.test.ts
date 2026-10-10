import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function mockFetchOk(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function mockFetchError(status: number, errorBody: unknown) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(errorBody),
  });
}

function mockFetchErrorNonJson(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.reject(new Error("not json")),
  });
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("shared request() behavior via getRuns (GET with optional query param)", () => {
    it("fetches without a query string when state is omitted", async () => {
      const fetchMock = mockFetchOk({ runs: [] });
      vi.stubGlobal("fetch", fetchMock);

      await api.getRuns();

      expect(fetchMock).toHaveBeenCalledWith("/api/runs", {
        headers: {},
      });
    });

    it("fetches with a state query string when state is provided", async () => {
      const fetchMock = mockFetchOk({ runs: [] });
      vi.stubGlobal("fetch", fetchMock);

      await api.getRuns("Active");

      expect(fetchMock).toHaveBeenCalledWith("/api/runs?state=Active", {
        headers: {},
      });
    });

    it("does not set Content-Type header since there is no body", async () => {
      const fetchMock = mockFetchOk({ runs: [] });
      vi.stubGlobal("fetch", fetchMock);

      await api.getRuns();

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers["Content-Type"]).toBeUndefined();
    });

    it("resolves with the parsed JSON body on success", async () => {
      const data = { runs: [{ id: "run-1" }] };
      vi.stubGlobal("fetch", mockFetchOk(data));

      const result = await api.getRuns();

      expect(result).toEqual(data);
    });

    it("rejects with the server-provided error message on a non-ok response", async () => {
      vi.stubGlobal("fetch", mockFetchError(404, { error: "Run not found" }));

      await expect(api.getRuns()).rejects.toThrow("Run not found");
    });

    it("falls back to 'HTTP <status>' when the error body is not valid JSON", async () => {
      vi.stubGlobal("fetch", mockFetchErrorNonJson(500));

      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });
  });

  describe("shared request() behavior via approvePlan (POST with a body)", () => {
    it("sends method POST and a JSON body with the note", async () => {
      const fetchMock = mockFetchOk({ ok: true, state: "AwaitingPlanApproval" });
      vi.stubGlobal("fetch", fetchMock);

      await api.approvePlan("run-1", "Looks good");

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/approve-plan",
        {
          headers: { "Content-Type": "application/json" },
          method: "POST",
          body: JSON.stringify({ note: "Looks good" }),
        },
      );
    });

    it("sets Content-Type: application/json when a body is present", async () => {
      const fetchMock = mockFetchOk({ ok: true, state: "x" });
      vi.stubGlobal("fetch", fetchMock);

      await api.approvePlan("run-1", "note");

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers["Content-Type"]).toBe("application/json");
    });

    it("turns an empty-string note into undefined in the JSON body", async () => {
      const fetchMock = mockFetchOk({ ok: true, state: "x" });
      vi.stubGlobal("fetch", fetchMock);

      await api.approvePlan("run-1", "");

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ note: undefined });
    });

    it("omits the note entirely when not passed", async () => {
      const fetchMock = mockFetchOk({ ok: true, state: "x" });
      vi.stubGlobal("fetch", fetchMock);

      await api.approvePlan("run-1");

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ note: undefined });
    });

    it("resolves with parsed JSON on success", async () => {
      const data = { ok: true, state: "AwaitingPlanApproval" };
      vi.stubGlobal("fetch", mockFetchOk(data));

      const result = await api.approvePlan("run-1", "note");

      expect(result).toEqual(data);
    });

    it("rejects with the server error message on a non-ok response", async () => {
      vi.stubGlobal("fetch", mockFetchError(400, { error: "Invalid state" }));

      await expect(api.approvePlan("run-1")).rejects.toThrow("Invalid state");
    });

    it("falls back to 'HTTP <status>' when the error body is not valid JSON", async () => {
      vi.stubGlobal("fetch", mockFetchErrorNonJson(500));

      await expect(api.approvePlan("run-1")).rejects.toThrow("HTTP 500");
    });
  });

  describe("shared request() behavior via approveReview / pauseRun (POST with no body)", () => {
    it("approveReview sends POST with no body and no Content-Type header", async () => {
      const fetchMock = mockFetchOk({ ok: true, state: "Implementing" });
      vi.stubGlobal("fetch", fetchMock);

      await api.approveReview("run-1");

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/approve-review",
        { headers: {}, method: "POST" },
      );
      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers["Content-Type"]).toBeUndefined();
      expect(init.body).toBeUndefined();
    });

    it("pauseRun sends POST with no body and no Content-Type header", async () => {
      const fetchMock = mockFetchOk({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      await api.pauseRun("run-1");

      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/pause", {
        headers: {},
        method: "POST",
      });
    });
  });

  describe("rejectPlan", () => {
    it("defaults mode to 'iterate' and omits context when neither is passed", async () => {
      const fetchMock = mockFetchOk({ ok: true, state: "PlanRevision" });
      vi.stubGlobal("fetch", fetchMock);

      await api.rejectPlan("run-1");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/reject-plan");
      expect(JSON.parse(init.body)).toEqual({
        context: undefined,
        mode: "iterate",
      });
    });

    it("turns an empty-string context into undefined", async () => {
      const fetchMock = mockFetchOk({ ok: true, state: "PlanRevision" });
      vi.stubGlobal("fetch", fetchMock);

      await api.rejectPlan("run-1", "", "fresh");

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ context: undefined, mode: "fresh" });
    });

    it("includes a non-empty context and the given mode", async () => {
      const fetchMock = mockFetchOk({ ok: true, state: "PlanRevision" });
      vi.stubGlobal("fetch", fetchMock);

      await api.rejectPlan("run-1", "needs more detail", "fresh");

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({
        context: "needs more detail",
        mode: "fresh",
      });
    });
  });

  describe("remaining api methods (URL + method + body shape)", () => {
    it("getRun fetches the run detail endpoint", async () => {
      const fetchMock = mockFetchOk({ run: {}, artifacts: [], events: [] });
      vi.stubGlobal("fetch", fetchMock);

      await api.getRun("run-1");

      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1", { headers: {} });
    });

    it("getRunSkills fetches the run skills endpoint", async () => {
      const fetchMock = mockFetchOk({
        injectedSkills: [],
        distillationDecision: null,
        distilledSkill: null,
      });
      vi.stubGlobal("fetch", fetchMock);

      await api.getRunSkills("run-1");

      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/skills", {
        headers: {},
      });
    });

    it("getArtifacts fetches the run artifacts endpoint", async () => {
      const fetchMock = mockFetchOk({ artifacts: [] });
      vi.stubGlobal("fetch", fetchMock);

      await api.getArtifacts("run-1");

      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/artifacts", {
        headers: {},
      });
    });

    it("getEvents fetches the run events endpoint", async () => {
      const fetchMock = mockFetchOk({ events: [] });
      vi.stubGlobal("fetch", fetchMock);

      await api.getEvents("run-1");

      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/events", {
        headers: {},
      });
    });

    it("reReviewPlan posts a note (present when provided)", async () => {
      const fetchMock = mockFetchOk({ ok: true, runId: "run-1" });
      vi.stubGlobal("fetch", fetchMock);

      await api.reReviewPlan("run-1", "re-review note");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/re-review-plan");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ note: "re-review note" });
    });

    it("reReviewPlan omits the note when not provided", async () => {
      const fetchMock = mockFetchOk({ ok: true, runId: "run-1" });
      vi.stubGlobal("fetch", fetchMock);

      await api.reReviewPlan("run-1");

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ note: undefined });
    });

    it("revisePlan posts a note (present when provided)", async () => {
      const fetchMock = mockFetchOk({ ok: true, runId: "run-1" });
      vi.stubGlobal("fetch", fetchMock);

      await api.revisePlan("run-1", "revise note");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/revise-plan");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ note: "revise note" });
    });

    it("revisePlan omits the note when not provided", async () => {
      const fetchMock = mockFetchOk({ ok: true, runId: "run-1" });
      vi.stubGlobal("fetch", fetchMock);

      await api.revisePlan("run-1");

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ note: undefined });
    });

    it("resumeRun posts with no body", async () => {
      const fetchMock = mockFetchOk({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      await api.resumeRun("run-1");

      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/resume", {
        headers: {},
        method: "POST",
      });
    });

    it("retryStage posts with no body", async () => {
      const fetchMock = mockFetchOk({ ok: true, state: "Implementing", retrying: true });
      vi.stubGlobal("fetch", fetchMock);

      await api.retryStage("run-1");

      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/retry", {
        headers: {},
        method: "POST",
      });
    });

    it("getActiveProcesses fetches without runId query when omitted", async () => {
      const fetchMock = mockFetchOk({ processes: [] });
      vi.stubGlobal("fetch", fetchMock);

      await api.getActiveProcesses();

      expect(fetchMock).toHaveBeenCalledWith("/api/processes", { headers: {} });
    });

    it("getActiveProcesses fetches with runId query when provided", async () => {
      const fetchMock = mockFetchOk({ processes: [] });
      vi.stubGlobal("fetch", fetchMock);

      await api.getActiveProcesses("xyz");

      expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=xyz", {
        headers: {},
      });
    });

    it("getProcessOutput fetches the process output endpoint with no body", async () => {
      const fetchMock = mockFetchOk({ processId: "p1", output: "log output" });
      vi.stubGlobal("fetch", fetchMock);

      await api.getProcessOutput("p1");

      expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/output", {
        headers: {},
      });
    });

    it("fetchPendingIssues fetches the pending linear issues endpoint", async () => {
      const fetchMock = mockFetchOk({ issues: [] });
      vi.stubGlobal("fetch", fetchMock);

      await api.fetchPendingIssues();

      expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
    });

    it("ingestIssues posts the issue ids array", async () => {
      const fetchMock = mockFetchOk({ ok: true, started: ["a"], skipped: [] });
      vi.stubGlobal("fetch", fetchMock);

      await api.ingestIssues(["a", "b"]);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/linear/ingest");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ issueIds: ["a", "b"] });
    });

    it("answerQuestions posts the answers array", async () => {
      const fetchMock = mockFetchOk({ ok: true, run: {} });
      vi.stubGlobal("fetch", fetchMock);

      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("run-1", answers);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/answer-questions");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ answers });
    });

    it("sendChatMessage posts the message", async () => {
      const fetchMock = mockFetchOk({ reply: "hi", durationMs: 10 });
      vi.stubGlobal("fetch", fetchMock);

      await api.sendChatMessage("run-1", "hello");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/runs/run-1/chat");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ message: "hello" });
    });
  });
});
