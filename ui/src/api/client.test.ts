import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
});
