import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue(response as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mockFetchRejectOnce(error: unknown) {
  const fetchMock = vi.fn().mockRejectedValue(error);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client — request plumbing", () => {
  it("GET requests carry no Content-Type header and no body", async () => {
    const fetchMock = mockFetchOnce(okResponse({ runs: [] }));

    await api.getRuns();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs");
    expect(init.headers).toEqual({});
    expect(init.body).toBeUndefined();
  });

  it("POST requests with a body set Content-Type: application/json", async () => {
    const fetchMock = mockFetchOnce(okResponse({ ok: true }));

    await api.pauseRun("run-1");
    // pauseRun sends no body, so Content-Type should NOT be set for it.
    let [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({});

    await api.approvePlan("run-1", "looks good");
    [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("resolves with the parsed JSON body on a successful response", async () => {
    const payload = { runs: [{ id: "run-1" }] };
    mockFetchOnce(okResponse(payload));

    const result = await api.getRuns();

    expect(result).toEqual(payload);
  });

  it("throws an Error using the response body's `error` field on a non-ok response", async () => {
    mockFetchOnce({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ error: "Validation failed" }),
    });

    await expect(api.getRuns()).rejects.toThrow("Validation failed");
  });

  it("falls back to `HTTP <status>` when a non-ok response body has no `error` field", async () => {
    mockFetchOnce({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    });

    await expect(api.getRuns()).rejects.toThrow("HTTP 503");
  });

  it("falls back to `HTTP <status>` when a non-ok response body is not valid JSON", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("Unexpected token")),
    });

    await expect(api.getRuns()).rejects.toThrow("HTTP 500");
  });

  it("propagates a network-level rejection (fetch itself throws)", async () => {
    mockFetchRejectOnce(new TypeError("Failed to fetch"));

    await expect(api.getRuns()).rejects.toThrow("Failed to fetch");
  });
});

describe("api client — GET endpoints", () => {
  it("getRuns() with no filter requests /api/runs", async () => {
    const fetchMock = mockFetchOnce(okResponse({ runs: [] }));
    await api.getRuns();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs");
  });

  it("getRuns(state) appends the state as a query param", async () => {
    const fetchMock = mockFetchOnce(okResponse({ runs: [] }));
    await api.getRuns("Implementing");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs?state=Implementing");
  });

  it("getRun(id) requests /api/runs/:id and returns run+artifacts+events", async () => {
    const payload = { run: { id: "r1" }, artifacts: [], events: [] };
    const fetchMock = mockFetchOnce(okResponse(payload));
    const result = await api.getRun("r1");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r1");
    expect(result).toEqual(payload);
  });

  it("getRunSkills(runId) requests /api/runs/:id/skills", async () => {
    const payload = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
    const fetchMock = mockFetchOnce(okResponse(payload));
    const result = await api.getRunSkills("r1");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r1/skills");
    expect(result).toEqual(payload);
  });

  it("getArtifacts(runId) requests /api/runs/:id/artifacts", async () => {
    const fetchMock = mockFetchOnce(okResponse({ artifacts: [] }));
    await api.getArtifacts("r1");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r1/artifacts");
  });

  it("getEvents(runId) requests /api/runs/:id/events", async () => {
    const fetchMock = mockFetchOnce(okResponse({ events: [] }));
    await api.getEvents("r1");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r1/events");
  });

  it("getActiveProcesses() with no runId requests /api/processes", async () => {
    const fetchMock = mockFetchOnce(okResponse({ processes: [] }));
    await api.getActiveProcesses();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes");
  });

  it("getActiveProcesses(runId) appends runId as a query param", async () => {
    const fetchMock = mockFetchOnce(okResponse({ processes: [] }));
    await api.getActiveProcesses("r1");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes?runId=r1");
  });

  it("getProcessOutput(processId) requests /api/processes/:id/output", async () => {
    const payload = { processId: "p1", output: "hello" };
    const fetchMock = mockFetchOnce(okResponse(payload));
    const result = await api.getProcessOutput("p1");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes/p1/output");
    expect(result).toEqual(payload);
  });

  it("fetchPendingIssues() requests /api/linear/pending", async () => {
    const payload = { issues: [{ id: "i1" }] };
    const fetchMock = mockFetchOnce(okResponse(payload));
    const result = await api.fetchPendingIssues();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/linear/pending");
    expect(result).toEqual(payload);
  });
});

describe("api client — POST endpoints (action verbs + bodies)", () => {
  function bodyOf(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0) {
    const [, init] = fetchMock.mock.calls[callIndex] as [string, RequestInit];
    return init.body ? JSON.parse(init.body as string) : undefined;
  }

  it("approvePlan sends POST with a note when provided", async () => {
    const fetchMock = mockFetchOnce(okResponse({ ok: true, state: "Implementing" }));
    await api.approvePlan("r1", "ship it");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/actions/approve-plan");
    expect(init.method).toBe("POST");
    expect(bodyOf(fetchMock)).toEqual({ note: "ship it" });
  });

  it("approvePlan omits the note field when not provided", async () => {
    const fetchMock = mockFetchOnce(okResponse({ ok: true, state: "Implementing" }));
    await api.approvePlan("r1");
    expect(bodyOf(fetchMock)).toEqual({});
  });

  it("rejectPlan sends context and defaults mode to 'iterate'", async () => {
    const fetchMock = mockFetchOnce(okResponse({ ok: true, state: "PlanRevision" }));
    await api.rejectPlan("r1", "needs work");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/actions/reject-plan");
    expect(bodyOf(fetchMock)).toEqual({ context: "needs work", mode: "iterate" });
  });

  it("rejectPlan forwards an explicit mode of 'fresh'", async () => {
    const fetchMock = mockFetchOnce(okResponse({ ok: true, state: "PlanRevision" }));
    await api.rejectPlan("r1", "start over", "fresh");
    expect(bodyOf(fetchMock)).toEqual({ context: "start over", mode: "fresh" });
  });

  it("rejectPlan omits context when not provided", async () => {
    const fetchMock = mockFetchOnce(okResponse({ ok: true, state: "PlanRevision" }));
    await api.rejectPlan("r1");
    expect(bodyOf(fetchMock)).toEqual({ mode: "iterate" });
  });

  it("reReviewPlan sends POST with optional note", async () => {
    const fetchMock = mockFetchOnce(okResponse({ ok: true, runId: "r1" }));
    await api.reReviewPlan("r1", "re-check this");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/actions/re-review-plan");
    expect(bodyOf(fetchMock)).toEqual({ note: "re-check this" });
  });

  it("reReviewPlan omits the note field when not provided", async () => {
    const fetchMock = mockFetchOnce(okResponse({ ok: true, runId: "r1" }));
    await api.reReviewPlan("r1");
    expect(bodyOf(fetchMock)).toEqual({});
  });

  it("revisePlan sends POST with optional note", async () => {
    const fetchMock = mockFetchOnce(okResponse({ ok: true, runId: "r1" }));
    await api.revisePlan("r1", "please revise");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/actions/revise-plan");
    expect(bodyOf(fetchMock)).toEqual({ note: "please revise" });
  });

  it("revisePlan omits the note field when not provided", async () => {
    const fetchMock = mockFetchOnce(okResponse({ ok: true, runId: "r1" }));
    await api.revisePlan("r1");
    expect(bodyOf(fetchMock)).toEqual({});
  });

  it("approveReview sends POST with no body", async () => {
    const fetchMock = mockFetchOnce(okResponse({ ok: true, state: "Done" }));
    await api.approveReview("r1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/actions/approve-review");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("pauseRun sends POST with no body", async () => {
    const fetchMock = mockFetchOnce(okResponse({ ok: true }));
    await api.pauseRun("r1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/actions/pause");
    expect(init.method).toBe("POST");
  });

  it("resumeRun sends POST with no body", async () => {
    const fetchMock = mockFetchOnce(okResponse({ ok: true }));
    await api.resumeRun("r1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/actions/resume");
    expect(init.method).toBe("POST");
  });

  it("retryStage sends POST with no body and returns retrying flag", async () => {
    const payload = { ok: true, state: "Implementing", retrying: true };
    const fetchMock = mockFetchOnce(okResponse(payload));
    const result = await api.retryStage("r1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/actions/retry");
    expect(init.method).toBe("POST");
    expect(result).toEqual(payload);
  });

  it("ingestIssues sends POST with the issueIds array", async () => {
    const payload = { ok: true, started: ["i1"], skipped: [] };
    const fetchMock = mockFetchOnce(okResponse(payload));
    const result = await api.ingestIssues(["i1", "i2"]);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/linear/ingest");
    expect(bodyOf(fetchMock)).toEqual({ issueIds: ["i1", "i2"] });
    expect(result).toEqual(payload);
  });

  it("answerQuestions sends POST with the answers array", async () => {
    const payload = { ok: true, run: { id: "r1" } };
    const fetchMock = mockFetchOnce(okResponse(payload));
    const answers = [{ questionId: "q1", answer: "yes" }];
    await api.answerQuestions("r1", answers);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/actions/answer-questions");
    expect(bodyOf(fetchMock)).toEqual({ answers });
  });

  it("sendChatMessage sends POST with the message and returns the reply", async () => {
    const payload = { reply: "Sure thing", durationMs: 42 };
    const fetchMock = mockFetchOnce(okResponse(payload));
    const result = await api.sendChatMessage("r1", "What's the status?");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/chat");
    expect(bodyOf(fetchMock)).toEqual({ message: "What's the status?" });
    expect(result).toEqual(payload);
  });

  it("a failed POST action rejects with the server's error message", async () => {
    mockFetchOnce({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: "Run is not awaiting approval" }),
    });

    await expect(api.approvePlan("r1")).rejects.toThrow("Run is not awaiting approval");
  });
});
