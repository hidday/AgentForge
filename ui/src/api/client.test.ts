import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  };
}

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getRuns requests /api/runs without a query string when no state is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns();
    expect(fetchMock).toHaveBeenCalledWith("/api/runs", expect.objectContaining({ headers: {} }));
  });

  it("getRuns appends the state query parameter when given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns("Todo,Planning");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs?state=Todo,Planning", expect.anything());
  });

  it("getRun requests /api/runs/:id and returns the parsed body", async () => {
    const body = { run: { id: "run-1" }, artifacts: [], events: [] };
    fetchMock.mockResolvedValue(jsonResponse(body));
    const result = await api.getRun("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1", expect.anything());
    expect(result).toEqual(body);
  });

  it("sets Content-Type: application/json only when a body is present", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
    await api.approvePlan("run-1", "note");

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    expect(options.method).toBe("POST");
    expect(options.body).toBe(JSON.stringify({ note: "note" }));
  });

  it("approvePlan omits the note field (sends undefined) when not given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
    await api.approvePlan("run-1");
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.body).toBe(JSON.stringify({ note: undefined }));
  });

  it("rejectPlan defaults mode to 'iterate' and omits a falsy context", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Planning" }));
    await api.rejectPlan("run-1");
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/run-1/actions/reject-plan");
    expect(JSON.parse(options.body as string)).toEqual({ context: undefined, mode: "iterate" });
  });

  it("rejectPlan forwards an explicit context and mode", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Planning" }));
    await api.rejectPlan("run-1", "needs oauth", "fresh");
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string)).toEqual({ context: "needs oauth", mode: "fresh" });
  });

  it("GET-only actions (approveReview, pauseRun, resumeRun, retryStage) send no body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api.approveReview("run-1");
    await api.pauseRun("run-1");
    await api.resumeRun("run-1");
    await api.retryStage("run-1");

    for (const call of fetchMock.mock.calls) {
      const options = call[1] as RequestInit;
      expect(options.method).toBe("POST");
      expect(options.body).toBeUndefined();
      expect(options.headers).toEqual({});
    }
  });

  it("getActiveProcesses omits the query string when no runId is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
    await api.getActiveProcesses();
    expect(fetchMock).toHaveBeenCalledWith("/api/processes", expect.anything());
  });

  it("getActiveProcesses filters by runId when given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));
    await api.getActiveProcesses("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=run-1", expect.anything());
  });

  it("getProcessOutput requests the process output endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ processId: "p1", output: "out" }));
    const result = await api.getProcessOutput("p1");
    expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/output", expect.anything());
    expect(result.output).toBe("out");
  });

  it("ingestIssues posts the issueIds array", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: ["a"], skipped: [] }));
    await api.ingestIssues(["a", "b"]);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/linear/ingest");
    expect(JSON.parse(options.body as string)).toEqual({ issueIds: ["a", "b"] });
  });

  it("answerQuestions posts the answers array", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, run: {} }));
    await api.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/run-1/actions/answer-questions");
    expect(JSON.parse(options.body as string)).toEqual({
      answers: [{ questionId: "q1", answer: "yes" }],
    });
  });

  it("sendChatMessage posts the message and returns the reply", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reply: "hi", durationMs: 10 }));
    const result = await api.sendChatMessage("run-1", "hello");
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runs/run-1/chat");
    expect(JSON.parse(options.body as string)).toEqual({ message: "hello" });
    expect(result.reply).toBe("hi");
  });

  it("fetchPendingIssues requests the Linear pending-issues endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));
    await api.fetchPendingIssues();
    expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
  });

  it("getRunSkills, getArtifacts, and getEvents hit their respective endpoints", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await api.getRunSkills("run-1");
    await api.getArtifacts("run-1");
    await api.getEvents("run-1");

    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      "/api/runs/run-1/skills",
      "/api/runs/run-1/artifacts",
      "/api/runs/run-1/events",
    ]);
  });

  it("reReviewPlan and revisePlan post an optional note", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
    await api.reReviewPlan("run-1", "check security");
    await api.revisePlan("run-1");

    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies).toEqual([{ note: "check security" }, { note: undefined }]);
  });

  it("reReviewPlan omits the note when none is given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
    await api.reReviewPlan("run-1");

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string)).toEqual({ note: undefined });
  });

  it("throws the server-provided error message when the response is not ok", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Run not found" }, false, 404));
    await expect(api.getRun("missing")).rejects.toThrow("Run not found");
  });

  it("falls back to 'HTTP <status>' when the error body cannot be parsed", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("not json")),
    });
    await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
  });

  it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 400));
    await expect(api.getRun("run-1")).rejects.toThrow("HTTP 400");
  });
});
