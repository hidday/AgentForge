import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "./client.ts";

function mockFetchOnce(response: {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: response.json ?? (() => Promise.resolve({})),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getRuns() without a state filter requests /api/runs with no query string", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ runs: [] }) });
    await api.getRuns();
    expect(fetchMock).toHaveBeenCalledWith("/api/runs", expect.objectContaining({ headers: {} }));
  });

  it("getRuns(state) appends the state as a query parameter", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ runs: [] }) });
    await api.getRuns("Done");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs?state=Done",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("getRun(id) resolves with the parsed JSON body on success", async () => {
    const payload = { run: { id: "r1" }, artifacts: [], events: [] };
    mockFetchOnce({ ok: true, json: () => Promise.resolve(payload) });
    const result = await api.getRun("r1");
    expect(result).toEqual(payload);
  });

  it("getActiveProcesses() without a runId requests /api/processes with no query string", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ processes: [] }) });
    await api.getActiveProcesses();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/processes",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("getActiveProcesses(runId) appends runId as a query parameter", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ processes: [] }) });
    await api.getActiveProcesses("run-9");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/processes?runId=run-9",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("approvePlan sends a POST with a JSON content-type header and the note in the body", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "Done" }) });
    await api.approvePlan("run-1", "looks good");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/approve-plan",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "looks good" }),
      }),
    );
  });

  it("approvePlan omits the note from the body when not provided", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "Done" }) });
    await api.approvePlan("run-1");
    const [, options] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(options.body as string)).toEqual({ note: undefined });
  });

  it("rejectPlan defaults mode to 'iterate' when not provided", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "Blocked" }) });
    await api.rejectPlan("run-1", "needs rework");
    const [, options] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(options.body as string)).toEqual({ context: "needs rework", mode: "iterate" });
  });

  it("rejectPlan forwards an explicit mode", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "Blocked" }) });
    await api.rejectPlan("run-1", "start over", "fresh");
    const [, options] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(options.body as string)).toEqual({ context: "start over", mode: "fresh" });
  });

  it("rejectPlan omits context from the body when not provided", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "Blocked" }) });
    await api.rejectPlan("run-1");
    const [, options] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(options.body as string)).toEqual({ mode: "iterate" });
  });

  it("pauseRun sends a bare POST with no body and no content-type header", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    await api.pauseRun("run-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/pause",
      expect.objectContaining({ method: "POST", headers: {} }),
    );
  });

  it("ingestIssues POSTs the issueIds array", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true, started: ["a"], skipped: [] }),
    });
    await api.ingestIssues(["a", "b"]);
    const [, options] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(options.body as string)).toEqual({ issueIds: ["a", "b"] });
  });

  it("answerQuestions POSTs the answers array", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, run: {} }) });
    const answers = [{ questionId: "q1", answer: "yes" }];
    await api.answerQuestions("run-1", answers);
    const [, options] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(options.body as string)).toEqual({ answers });
  });

  it("throws the body's `error` field when the response is not ok", async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "invalid state transition" }),
    });
    await expect(api.pauseRun("run-1")).rejects.toThrow("invalid state transition");
  });

  it("falls back to `HTTP <status>` when the error body is not valid JSON", async () => {
    mockFetchOnce({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error("not json")),
    });
    await expect(api.pauseRun("run-1")).rejects.toThrow("HTTP 503");
  });

  it("falls back to `HTTP <status>` when the error body parses but has no `error` field", async () => {
    mockFetchOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: "not found" }),
    });
    await expect(api.getRun("missing")).rejects.toThrow("HTTP 404");
  });

  it("getRunSkills() requests /api/runs/:id/skills and returns the parsed body", async () => {
    const payload = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve(payload) });
    const result = await api.getRunSkills("run-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/skills",
      expect.objectContaining({ headers: {} }),
    );
    expect(result).toEqual(payload);
  });

  it("getArtifacts() requests /api/runs/:id/artifacts and returns the parsed body", async () => {
    const payload = { artifacts: [] };
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve(payload) });
    const result = await api.getArtifacts("run-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/artifacts",
      expect.objectContaining({ headers: {} }),
    );
    expect(result).toEqual(payload);
  });

  it("getEvents() requests /api/runs/:id/events and returns the parsed body", async () => {
    const payload = { events: [] };
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve(payload) });
    const result = await api.getEvents("run-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/events",
      expect.objectContaining({ headers: {} }),
    );
    expect(result).toEqual(payload);
  });

  it("reReviewPlan sends a POST with the note in the body", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) });
    await api.reReviewPlan("run-1", "please re-check");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/re-review-plan",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "please re-check" }),
      }),
    );
  });

  it("reReviewPlan omits the note from the body when not provided", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) });
    await api.reReviewPlan("run-1");
    const [, options] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(options.body as string)).toEqual({ note: undefined });
  });

  it("revisePlan sends a POST with the note in the body", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) });
    await api.revisePlan("run-1", "tweak the approach");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/revise-plan",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "tweak the approach" }),
      }),
    );
  });

  it("revisePlan omits the note from the body when not provided", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) });
    await api.revisePlan("run-1");
    const [, options] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(options.body as string)).toEqual({ note: undefined });
  });

  it("approveReview sends a bare POST with no body and no content-type header", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true, state: "Approved" }) });
    await api.approveReview("run-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/approve-review",
      expect.objectContaining({ method: "POST", headers: {} }),
    );
  });

  it("resumeRun sends a bare POST with no body and no content-type header", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });
    await api.resumeRun("run-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/resume",
      expect.objectContaining({ method: "POST", headers: {} }),
    );
  });

  it("retryStage sends a bare POST and returns the parsed body", async () => {
    const payload = { ok: true, state: "Executing", retrying: true };
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve(payload) });
    const result = await api.retryStage("run-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/retry",
      expect.objectContaining({ method: "POST", headers: {} }),
    );
    expect(result).toEqual(payload);
  });

  it("getProcessOutput() requests /api/processes/:id/output and returns the parsed body", async () => {
    const payload = { processId: "p1", output: "hello" };
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve(payload) });
    const result = await api.getProcessOutput("p1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/processes/p1/output",
      expect.objectContaining({ headers: {} }),
    );
    expect(result).toEqual(payload);
  });

  it("fetchPendingIssues() requests /api/linear/pending and returns the parsed body", async () => {
    const payload = { issues: [] };
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve(payload) });
    const result = await api.fetchPendingIssues();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/linear/pending",
      expect.objectContaining({ headers: {} }),
    );
    expect(result).toEqual(payload);
  });

  it("sendChatMessage POSTs the message and returns the reply", async () => {
    const payload = { reply: "hi there", durationMs: 42 };
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve(payload) });
    const result = await api.sendChatMessage("run-1", "hello?");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/chat",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello?" }),
      }),
    );
    expect(result).toEqual(payload);
  });
});
