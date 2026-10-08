import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall(): [string, RequestInit] {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
}

describe("api client request handling", () => {
  it("issues a GET without a Content-Type header and returns parsed JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: [{ id: "r1" }] }));
    const result = await api.getRuns();
    expect(result).toEqual({ runs: [{ id: "r1" }] });
    const [url, init] = lastCall();
    expect(url).toBe("/api/runs");
    expect(init.method).toBeUndefined();
    expect(init.headers).toEqual({});
  });

  it("adds a state query string when filtering runs", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns("Planning");
    expect(lastCall()[0]).toBe("/api/runs?state=Planning");
  });

  it("throws the server-provided error message on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Run not found" }, { ok: false, status: 404 }));
    await expect(api.getRun("missing")).rejects.toThrow("Run not found");
  });

  it("falls back to HTTP status when the error body has no error field", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));
    await expect(api.getRun("x")).rejects.toThrow("HTTP 500");
  });

  it("falls back to HTTP status when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: vi.fn().mockRejectedValue(new SyntaxError("bad json")),
    } as unknown as Response);
    await expect(api.getRunSkills("x")).rejects.toThrow("HTTP 502");
  });

  it("propagates network failures from fetch", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.getEvents("r1")).rejects.toThrow("Failed to fetch");
  });
});

describe("api client endpoints", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
  });

  it.each([
    ["getRun", () => api.getRun("r1"), "/api/runs/r1"],
    ["getRunSkills", () => api.getRunSkills("r1"), "/api/runs/r1/skills"],
    ["getArtifacts", () => api.getArtifacts("r1"), "/api/runs/r1/artifacts"],
    ["getEvents", () => api.getEvents("r1"), "/api/runs/r1/events"],
    ["getActiveProcesses (all)", () => api.getActiveProcesses(), "/api/processes"],
    ["getActiveProcesses (run)", () => api.getActiveProcesses("r1"), "/api/processes?runId=r1"],
    ["getProcessOutput", () => api.getProcessOutput("p1"), "/api/processes/p1/output"],
    ["fetchPendingIssues", () => api.fetchPendingIssues(), "/api/linear/pending"],
  ])("%s GETs the right URL", async (_name, call, url) => {
    await call();
    const [calledUrl, init] = lastCall();
    expect(calledUrl).toBe(url);
    expect(init.method).toBeUndefined();
  });

  it.each([
    ["approveReview", () => api.approveReview("r1"), "/api/runs/r1/actions/approve-review"],
    ["pauseRun", () => api.pauseRun("r1"), "/api/runs/r1/actions/pause"],
    ["resumeRun", () => api.resumeRun("r1"), "/api/runs/r1/actions/resume"],
    ["retryStage", () => api.retryStage("r1"), "/api/runs/r1/actions/retry"],
  ])("%s POSTs without a body or Content-Type", async (_name, call, url) => {
    await call();
    const [calledUrl, init] = lastCall();
    expect(calledUrl).toBe(url);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({});
  });

  it.each([
    [
      "approvePlan with note",
      () => api.approvePlan("r1", "lgtm"),
      "/api/runs/r1/actions/approve-plan",
      { note: "lgtm" },
    ],
    [
      "approvePlan with empty note omits it",
      () => api.approvePlan("r1", ""),
      "/api/runs/r1/actions/approve-plan",
      {},
    ],
    [
      "rejectPlan defaults to iterate mode",
      () => api.rejectPlan("r1", "too vague"),
      "/api/runs/r1/actions/reject-plan",
      { context: "too vague", mode: "iterate" },
    ],
    [
      "rejectPlan fresh without context",
      () => api.rejectPlan("r1", undefined, "fresh"),
      "/api/runs/r1/actions/reject-plan",
      { mode: "fresh" },
    ],
    [
      "reReviewPlan",
      () => api.reReviewPlan("r1", "check again"),
      "/api/runs/r1/actions/re-review-plan",
      { note: "check again" },
    ],
    [
      "reReviewPlan without note",
      () => api.reReviewPlan("r1"),
      "/api/runs/r1/actions/re-review-plan",
      {},
    ],
    [
      "revisePlan with note",
      () => api.revisePlan("r1", "tighten"),
      "/api/runs/r1/actions/revise-plan",
      { note: "tighten" },
    ],
    [
      "revisePlan without note",
      () => api.revisePlan("r1"),
      "/api/runs/r1/actions/revise-plan",
      {},
    ],
    [
      "ingestIssues",
      () => api.ingestIssues(["a", "b"]),
      "/api/linear/ingest",
      { issueIds: ["a", "b"] },
    ],
    [
      "answerQuestions",
      () => api.answerQuestions("r1", [{ questionId: "q1", answer: "yes" }]),
      "/api/runs/r1/actions/answer-questions",
      { answers: [{ questionId: "q1", answer: "yes" }] },
    ],
    [
      "sendChatMessage",
      () => api.sendChatMessage("r1", "hello"),
      "/api/runs/r1/chat",
      { message: "hello" },
    ],
  ])("%s POSTs JSON body", async (_name, call, url, body) => {
    await call();
    const [calledUrl, init] = lastCall();
    expect(calledUrl).toBe(url);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(body);
  });
});
