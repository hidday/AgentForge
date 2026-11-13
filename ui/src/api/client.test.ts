import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function mockFetchOnce(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET requests hit the expected path with no body/content-type header", async () => {
    const fetchMock = mockFetchOnce(200, { runs: [] });
    await api.getRuns();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("appends a state query param when provided to getRuns", async () => {
    const fetchMock = mockFetchOnce(200, { runs: [] });
    await api.getRuns("Done");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs?state=Done", expect.anything());
  });

  it("getRun fetches the run detail path and returns the parsed JSON", async () => {
    const payload = { run: { id: "r1" }, artifacts: [], events: [] };
    mockFetchOnce(200, payload);
    const result = await api.getRun("r1");
    expect(result).toEqual(payload);
  });

  it("POST requests set Content-Type and include a JSON body", async () => {
    const fetchMock = mockFetchOnce(200, { ok: true, state: "PlanReview" });
    await api.approvePlan("r1", "looks good");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/r1/actions/approve-plan",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "looks good" }),
      }),
    );
  });

  it("omits an empty note by serializing it as undefined", async () => {
    const fetchMock = mockFetchOnce(200, { ok: true, state: "PlanReview" });
    await api.approvePlan("r1");
    const [, options] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({});
  });

  it("rejectPlan defaults mode to 'iterate' when not supplied", async () => {
    const fetchMock = mockFetchOnce(200, { ok: true, state: "Planning" });
    await api.rejectPlan("r1");
    const [, options] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({ mode: "iterate" });
  });

  it("getActiveProcesses appends runId query param only when provided", async () => {
    const fetchMock = mockFetchOnce(200, { processes: [] });
    await api.getActiveProcesses();
    expect(fetchMock).toHaveBeenCalledWith("/api/processes", expect.anything());

    await api.getActiveProcesses("r1");
    expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=r1", expect.anything());
  });

  it("throws an Error using the response's error field on a non-ok response", async () => {
    mockFetchOnce(400, { error: "Bad request" }, false);
    await expect(api.getRuns()).rejects.toThrow("Bad request");
  });

  it("falls back to an 'HTTP <status>' message when the error body has no error field", async () => {
    mockFetchOnce(500, {}, false);
    await expect(api.getRuns()).rejects.toThrow("HTTP 500");
  });

  it("falls back to an 'HTTP <status>' message when the error body cannot be parsed as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected end of JSON input")),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.getRuns()).rejects.toThrow("HTTP 503");
  });

  it("ingestIssues POSTs the issue id list", async () => {
    const fetchMock = mockFetchOnce(200, { ok: true, started: ["a"], skipped: [] });
    await api.ingestIssues(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/linear/ingest",
      expect.objectContaining({ body: JSON.stringify({ issueIds: ["a", "b"] }) }),
    );
  });

  it("answerQuestions POSTs the answers array", async () => {
    const fetchMock = mockFetchOnce(200, { ok: true, run: {} });
    await api.answerQuestions("r1", [{ questionId: "q1", answer: "yes" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/r1/actions/answer-questions",
      expect.objectContaining({
        body: JSON.stringify({ answers: [{ questionId: "q1", answer: "yes" }] }),
      }),
    );
  });

  it("sendChatMessage POSTs to the run's chat endpoint", async () => {
    const fetchMock = mockFetchOnce(200, { reply: "hi", durationMs: 10 });
    const result = await api.sendChatMessage("r1", "hello");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/r1/chat",
      expect.objectContaining({ body: JSON.stringify({ message: "hello" }) }),
    );
    expect(result).toEqual({ reply: "hi", durationMs: 10 });
  });

  it("pauseRun/resumeRun/retryStage/approveReview issue bare POSTs with no body", async () => {
    const fetchMock = mockFetchOnce(200, { ok: true });
    await api.pauseRun("r1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/r1/actions/pause",
      expect.objectContaining({ method: "POST", headers: {} }),
    );
  });

  it("fetchPendingIssues issues a GET to /linear/pending", async () => {
    const fetchMock = mockFetchOnce(200, { issues: [] });
    await api.fetchPendingIssues();
    expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
  });

  it("getProcessOutput fetches the process output path", async () => {
    mockFetchOnce(200, { processId: "p1", output: "log" });
    const result = await api.getProcessOutput("p1");
    expect(result).toEqual({ processId: "p1", output: "log" });
  });
});
