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
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------
  // URL / method / body construction
  // -------------------------------------------------------------------

  it("getRuns requests /api/runs with no query string when no filter is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns();
    expect(fetchMock).toHaveBeenCalledWith("/api/runs", expect.objectContaining({ headers: {} }));
  });

  it("getRuns appends ?state= when a filter is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns("Planning");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs?state=Planning",
      expect.anything(),
    );
  });

  it("getRun requests /api/runs/:id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ run: {}, artifacts: [], events: [] }));
    await api.getRun("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1", expect.anything());
  });

  it("getRunSkills requests /api/runs/:id/skills", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
    );
    await api.getRunSkills("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/skills", expect.anything());
  });

  it("getArtifacts requests /api/runs/:id/artifacts", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ artifacts: [] }));
    await api.getArtifacts("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/artifacts", expect.anything());
  });

  it("getEvents requests /api/runs/:id/events", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ events: [] }));
    await api.getEvents("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/events", expect.anything());
  });

  it("approvePlan POSTs with a JSON body containing the note", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
    await api.approvePlan("run-1", "looks good");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "looks good" }),
    });
  });

  it("approvePlan omits the note (undefined) when none is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
    await api.approvePlan("run-1");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({});
  });

  it("rejectPlan POSTs context and defaults mode to 'iterate'", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));
    await api.rejectPlan("run-1", "needs more detail");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/runs/run-1/actions/reject-plan");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ context: "needs more detail", mode: "iterate" });
  });

  it("rejectPlan forwards an explicit 'fresh' mode", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));
    await api.rejectPlan("run-1", undefined, "fresh");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ context: undefined, mode: "fresh" });
  });

  it("reReviewPlan POSTs to the re-review-plan action", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
    await api.reReviewPlan("run-1", "note");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/runs/run-1/actions/re-review-plan");
    expect(JSON.parse(init.body)).toEqual({ note: "note" });
  });

  it("reReviewPlan omits the note when called without one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
    await api.reReviewPlan("run-1");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({});
  });

  it("revisePlan POSTs to the revise-plan action", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
    await api.revisePlan("run-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/runs/run-1/actions/revise-plan");
    expect(JSON.parse(init.body)).toEqual({ note: undefined });
  });

  it("approveReview POSTs with no body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Done" }));
    await api.approveReview("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-review", {
      method: "POST",
      headers: {},
    });
  });

  it("pauseRun POSTs to the pause action", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api.pauseRun("run-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/pause",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resumeRun POSTs to the resume action", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api.resumeRun("run-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/resume",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("retryStage POSTs to the retry action", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing", retrying: true }));
    await api.retryStage("run-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/retry",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("getActiveProcesses with no runId omits the query string", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
    await api.getActiveProcesses();
    expect(fetchMock).toHaveBeenCalledWith("/api/processes", expect.anything());
  });

  it("getActiveProcesses with a runId appends ?runId=", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
    await api.getActiveProcesses("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=run-1", expect.anything());
  });

  it("getProcessOutput requests /api/processes/:id/output", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ processId: "p1", output: "" }));
    await api.getProcessOutput("p1");
    expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/output", expect.anything());
  });

  it("fetchPendingIssues requests /api/linear/pending", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));
    await api.fetchPendingIssues();
    expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
  });

  it("ingestIssues POSTs the issueIds array", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: [], skipped: [] }));
    await api.ingestIssues(["a", "b"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/linear/ingest");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ issueIds: ["a", "b"] });
  });

  it("answerQuestions POSTs runId's answers array", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, run: {} }));
    const answers = [{ questionId: "q1", answer: "yes" }];
    await api.answerQuestions("run-1", answers);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/runs/run-1/actions/answer-questions");
    expect(JSON.parse(init.body)).toEqual({ answers });
  });

  it("sendChatMessage POSTs the message", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reply: "hi", durationMs: 10 }));
    await api.sendChatMessage("run-1", "hello");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/runs/run-1/chat");
    expect(JSON.parse(init.body)).toEqual({ message: "hello" });
  });

  // -------------------------------------------------------------------
  // Successful response parsing
  // -------------------------------------------------------------------

  it("resolves with the parsed JSON body on success", async () => {
    const payload = { runs: [{ id: "run-1" }] };
    fetchMock.mockResolvedValue(jsonResponse(payload));
    const result = await api.getRuns();
    expect(result).toEqual(payload);
  });

  // -------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------

  it("throws an Error using the server-provided error message on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Run not found" }, false, 404));
    await expect(api.getRun("missing")).rejects.toThrow("Run not found");
  });

  it("falls back to an 'HTTP <status>' message when the error body has no error field", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
    await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
  });

  it("falls back to an 'HTTP <status>' message when the error body is not valid JSON", async () => {
    const res = {
      ok: false,
      status: 503,
      json: vi.fn().mockRejectedValue(new Error("Unexpected end of JSON input")),
    } as unknown as Response;
    fetchMock.mockResolvedValue(res);
    await expect(api.getRuns()).rejects.toThrow("HTTP 503");
  });

  it("propagates a network error thrown by fetch itself", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.getRuns()).rejects.toThrow("Failed to fetch");
  });

  it("rejects when the success response body is malformed JSON", async () => {
    const res = {
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
    } as unknown as Response;
    fetchMock.mockResolvedValue(res);
    await expect(api.getRuns()).rejects.toThrow("Unexpected token");
  });

  // -------------------------------------------------------------------
  // Content-Type header behavior
  // -------------------------------------------------------------------

  it("does not set a Content-Type header for bodyless GET requests", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({});
  });

  it("sets Content-Type: application/json for requests with a body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
    await api.approvePlan("run-1", "note");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });
});
