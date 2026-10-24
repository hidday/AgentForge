import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getRuns requests /api/runs without a query string when no state is given", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));

    const result = await api.getRuns();

    expect(fetchMock).toHaveBeenCalledWith("/api/runs", expect.objectContaining({ headers: {} }));
    expect(result).toEqual({ runs: [] });
  });

  it("getRuns appends the state filter as a query string when provided", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));

    await api.getRuns("Implementing");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs?state=Implementing",
      expect.anything(),
    );
  });

  it("getRun requests the run detail endpoint by id", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const payload = { run: { id: "r1" }, artifacts: [], events: [] };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const result = await api.getRun("r1");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1", expect.anything());
    expect(result).toEqual(payload);
  });

  it("sets Content-Type: application/json when the request has a body", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));

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

  it("approvePlan omits the note field value when no note is given", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));

    await api.approvePlan("r1");

    const call = fetchMock.mock.calls[0];
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ note: undefined });
  });

  it("rejectPlan defaults mode to 'iterate' when not specified", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));

    await api.rejectPlan("r1", "needs more detail");

    const call = fetchMock.mock.calls[0];
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      context: "needs more detail",
      mode: "iterate",
    });
  });

  it("rejectPlan forwards an explicit 'fresh' mode", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));

    await api.rejectPlan("r1", undefined, "fresh");

    const call = fetchMock.mock.calls[0];
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      context: undefined,
      mode: "fresh",
    });
  });

  it("pauseRun and resumeRun POST with no body", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.pauseRun("r1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/runs/r1/actions/pause",
      expect.objectContaining({ method: "POST", headers: {} }),
    );

    await api.resumeRun("r1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/runs/r1/actions/resume",
      expect.objectContaining({ method: "POST", headers: {} }),
    );
  });

  it("getActiveProcesses omits the runId query param when not given", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));

    await api.getActiveProcesses();

    expect(fetchMock).toHaveBeenCalledWith("/api/processes", expect.anything());
  });

  it("getActiveProcesses includes the runId query param when given", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));

    await api.getActiveProcesses("r1");

    expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=r1", expect.anything());
  });

  it("ingestIssues POSTs the issueIds array as the body", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: ["a"], skipped: [] }));

    await api.ingestIssues(["a", "b"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/linear/ingest",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ issueIds: ["a", "b"] }),
      }),
    );
  });

  it("answerQuestions POSTs the answers array", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, run: {} }));

    const answers = [{ questionId: "q1", answer: "yes" }];
    await api.answerQuestions("r1", answers);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/r1/actions/answer-questions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ answers }),
      }),
    );
  });

  it("sendChatMessage POSTs the message and returns the reply payload", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ reply: "hi", durationMs: 10 }));

    const result = await api.sendChatMessage("r1", "hello");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/r1/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      }),
    );
    expect(result).toEqual({ reply: "hi", durationMs: 10 });
  });

  it("throws the error message from the response body when the request fails", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ error: "Run not found" }, false, 404));

    await expect(api.getRun("missing")).rejects.toThrow("Run not found");
  });

  it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({}, false, 500));

    await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
  });

  it("falls back to 'HTTP <status>' when the error response body is not valid JSON", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error("invalid json")),
    } as unknown as Response);

    await expect(api.getRun("r1")).rejects.toThrow("HTTP 503");
  });

  it("fetchPendingIssues requests the linear pending endpoint", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));

    await api.fetchPendingIssues();

    expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
  });

  it("retryStage, approveReview, getArtifacts, and getEvents call the expected endpoints", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.retryStage("r1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/runs/r1/actions/retry",
      expect.objectContaining({ method: "POST" }),
    );

    await api.approveReview("r1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/runs/r1/actions/approve-review",
      expect.objectContaining({ method: "POST" }),
    );

    await api.getArtifacts("r1");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/runs/r1/artifacts", expect.anything());

    await api.getEvents("r1");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/runs/r1/events", expect.anything());
  });

  it("getProcessOutput and reReviewPlan/revisePlan call the expected endpoints", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.getProcessOutput("p1");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/processes/p1/output", expect.anything());

    await api.reReviewPlan("r1", "note");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/runs/r1/actions/re-review-plan",
      expect.objectContaining({ method: "POST" }),
    );

    await api.revisePlan("r1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/runs/r1/actions/revise-plan",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("getRunSkills requests the run skills endpoint", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
    );

    await api.getRunSkills("r1");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/skills", expect.anything());
  });
});
