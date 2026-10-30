import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

type FetchMock = ReturnType<typeof vi.fn>;

describe("api client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchOnce(body: unknown, ok = true, status = 200) {
    (globalThis.fetch as FetchMock).mockResolvedValueOnce({
      ok,
      status,
      json: () => Promise.resolve(body),
    });
  }

  it("getRuns calls /api/runs with no query string when no state filter is given", async () => {
    mockFetchOnce({ runs: [] });
    const result = await api.getRuns();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
    expect(result).toEqual({ runs: [] });
  });

  it("getRuns appends the state query param when provided", async () => {
    mockFetchOnce({ runs: [] });
    await api.getRuns("completed");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs?state=completed", { headers: {} });
  });

  it("getRun requests the run detail endpoint", async () => {
    mockFetchOnce({ run: {}, artifacts: [], events: [] });
    await api.getRun("run-1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1", { headers: {} });
  });

  it("getRunSkills requests the skills endpoint", async () => {
    mockFetchOnce({ injectedSkills: [], distillationDecision: null, distilledSkill: null });
    await api.getRunSkills("run-1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/skills", { headers: {} });
  });

  it("getArtifacts requests the artifacts endpoint", async () => {
    mockFetchOnce({ artifacts: [] });
    await api.getArtifacts("run-1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/artifacts", { headers: {} });
  });

  it("getEvents requests the events endpoint", async () => {
    mockFetchOnce({ events: [] });
    await api.getEvents("run-1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/events", { headers: {} });
  });

  it("approvePlan POSTs the note, omitting it when not given", async () => {
    mockFetchOnce({ ok: true, state: "approved" });
    await api.approvePlan("run-1", "looks good");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "looks good" }),
    });

    mockFetchOnce({ ok: true, state: "approved" });
    await api.approvePlan("run-1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: undefined }),
    });
  });

  it("rejectPlan defaults mode to 'iterate' and passes context/mode through when given", async () => {
    mockFetchOnce({ ok: true, state: "rejected" });
    await api.rejectPlan("run-1", "needs work", "fresh");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/reject-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ context: "needs work", mode: "fresh" }),
    });

    mockFetchOnce({ ok: true, state: "rejected" });
    await api.rejectPlan("run-1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/reject-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ context: undefined, mode: "iterate" }),
    });
  });

  it("reReviewPlan POSTs an optional note", async () => {
    mockFetchOnce({ ok: true, runId: "run-1" });
    await api.reReviewPlan("run-1", "double check");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/re-review-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "double check" }),
    });

    mockFetchOnce({ ok: true, runId: "run-1" });
    await api.reReviewPlan("run-1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/re-review-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: undefined }),
    });
  });

  it("revisePlan POSTs an optional note", async () => {
    mockFetchOnce({ ok: true, runId: "run-1" });
    await api.revisePlan("run-1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/revise-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: undefined }),
    });
  });

  it("approveReview POSTs without a body", async () => {
    mockFetchOnce({ ok: true, state: "approved" });
    await api.approveReview("run-1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-review", {
      headers: {},
      method: "POST",
    });
  });

  it("pauseRun and resumeRun POST without a body", async () => {
    mockFetchOnce({ ok: true });
    await api.pauseRun("run-1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/pause", {
      headers: {},
      method: "POST",
    });

    mockFetchOnce({ ok: true });
    await api.resumeRun("run-1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/resume", {
      headers: {},
      method: "POST",
    });
  });

  it("retryStage POSTs without a body", async () => {
    mockFetchOnce({ ok: true, state: "running", retrying: true });
    await api.retryStage("run-1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/retry", {
      headers: {},
      method: "POST",
    });
  });

  it("getActiveProcesses omits the query string without a runId and includes it with one", async () => {
    mockFetchOnce({ processes: [] });
    await api.getActiveProcesses();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });

    mockFetchOnce({ processes: [] });
    await api.getActiveProcesses("run-1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes?runId=run-1", { headers: {} });
  });

  it("getProcessOutput requests the process output endpoint", async () => {
    mockFetchOnce({ processId: "p1", output: "" });
    await api.getProcessOutput("p1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
  });

  it("fetchPendingIssues requests the pending linear issues endpoint", async () => {
    mockFetchOnce({ issues: [] });
    await api.fetchPendingIssues();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
  });

  it("ingestIssues POSTs the issue ids", async () => {
    mockFetchOnce({ ok: true, started: [], skipped: [] });
    await api.ingestIssues(["a", "b"]);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/linear/ingest", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ issueIds: ["a", "b"] }),
    });
  });

  it("answerQuestions POSTs the answers", async () => {
    mockFetchOnce({ ok: true, run: {} });
    await api.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/answer-questions", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ answers: [{ questionId: "q1", answer: "yes" }] }),
    });
  });

  it("sendChatMessage POSTs the message", async () => {
    mockFetchOnce({ reply: "hi", durationMs: 10 });
    await api.sendChatMessage("run-1", "hello");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/run-1/chat", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
    });
  });

  it("throws the server-provided error message when the response is not ok", async () => {
    mockFetchOnce({ error: "Not found" }, false, 404);
    await expect(api.getRun("missing")).rejects.toThrow("Not found");
  });

  it("falls back to an HTTP status message when the error body has no error field", async () => {
    mockFetchOnce({}, false, 500);
    await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
  });

  it("falls back to an HTTP status message when the error body is not valid JSON", async () => {
    (globalThis.fetch as FetchMock).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error("invalid json")),
    });
    await expect(api.getRun("run-1")).rejects.toThrow("HTTP 503");
  });
});
