import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET requests omit Content-Type header and hit the correct path", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ runs: [] }));

    await api.getRuns();

    expect(fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
  });

  it("getRuns appends a state query param when provided", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ runs: [] }));

    await api.getRuns("Planning");

    expect(fetch).toHaveBeenCalledWith("/api/runs?state=Planning", { headers: {} });
  });

  it("POST requests with a body set Content-Type: application/json and send the JSON body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ ok: true, state: "PlanReview" }),
    );

    await api.approvePlan("run-1", "looks good");

    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "looks good" }),
    });
  });

  it("omits an empty optional note by coercing it to undefined in the body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ ok: true, state: "PlanReview" }),
    );

    await api.approvePlan("run-1", "");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/approve-plan",
      expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
    );
  });

  it("rejectPlan defaults mode to 'iterate' when not provided", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ ok: true, state: "Planning" }),
    );

    await api.rejectPlan("run-1");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/reject-plan",
      expect.objectContaining({
        body: JSON.stringify({ context: undefined, mode: "iterate" }),
      }),
    );
  });

  it("POST requests without a body (e.g. pauseRun) send no Content-Type header", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ ok: true }));

    await api.pauseRun("run-1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/pause", {
      headers: {},
      method: "POST",
    });
  });

  it("getActiveProcesses appends a runId query param only when provided", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ processes: [] }));
    await api.getActiveProcesses("run-9");
    expect(fetch).toHaveBeenCalledWith("/api/processes?runId=run-9", { headers: {} });

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ processes: [] }));
    await api.getActiveProcesses();
    expect(fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
  });

  it("resolves with the parsed JSON body on a successful response", async () => {
    const run = { id: "run-1", state: "Done" };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ run, artifacts: [], events: [] }),
    );

    const result = await api.getRun("run-1");

    expect(result).toEqual({ run, artifacts: [], events: [] });
  });

  it("throws the server-provided error message when the response is not ok", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ error: "run not found" }, false, 404),
    );

    await expect(api.getRun("missing")).rejects.toThrow("run not found");
  });

  it("falls back to an 'HTTP <status>' message when the error body has no error field", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({}, false, 500));

    await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
  });

  it("falls back to an 'HTTP <status>' message when the error body fails to parse as JSON", async () => {
    const res = {
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error("not json")),
    } as unknown as Response;
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(res);

    await expect(api.getRun("run-1")).rejects.toThrow("HTTP 503");
  });

  it("ingestIssues sends the issueIds array as the JSON body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ ok: true, started: ["a"], skipped: [] }),
    );

    await api.ingestIssues(["a", "b"]);

    expect(fetch).toHaveBeenCalledWith(
      "/api/linear/ingest",
      expect.objectContaining({ body: JSON.stringify({ issueIds: ["a", "b"] }) }),
    );
  });

  it("answerQuestions posts runId-scoped answers", async () => {
    const run = { id: "run-1" };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ ok: true, run }));

    const answers = [{ questionId: "q1", answer: "yes" }];
    const result = await api.answerQuestions("run-1", answers);

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/answer-questions",
      expect.objectContaining({ body: JSON.stringify({ answers }) }),
    );
    expect(result).toEqual({ ok: true, run });
  });

  it("sendChatMessage posts the message and returns the reply", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ reply: "hi", durationMs: 12 }),
    );

    const result = await api.sendChatMessage("run-1", "hello");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/chat",
      expect.objectContaining({ body: JSON.stringify({ message: "hello" }) }),
    );
    expect(result).toEqual({ reply: "hi", durationMs: 12 });
  });

  it("fetchPendingIssues hits the linear/pending endpoint", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ issues: [] }));
    await api.fetchPendingIssues();
    expect(fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
  });

  it("getProcessOutput hits the process output endpoint", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ processId: "p1", output: "log" }),
    );
    const result = await api.getProcessOutput("p1");
    expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
    expect(result).toEqual({ processId: "p1", output: "log" });
  });

  it("retryStage and resumeRun and reReviewPlan and revisePlan and approveReview hit their routes", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

    await api.retryStage("run-1");
    expect(fetch).toHaveBeenLastCalledWith("/api/runs/run-1/actions/retry", {
      headers: {},
      method: "POST",
    });

    await api.resumeRun("run-1");
    expect(fetch).toHaveBeenLastCalledWith("/api/runs/run-1/actions/resume", {
      headers: {},
      method: "POST",
    });

    await api.approveReview("run-1");
    expect(fetch).toHaveBeenLastCalledWith("/api/runs/run-1/actions/approve-review", {
      headers: {},
      method: "POST",
    });

    await api.reReviewPlan("run-1", "note");
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/runs/run-1/actions/re-review-plan",
      expect.objectContaining({ body: JSON.stringify({ note: "note" }) }),
    );

    await api.revisePlan("run-1");
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/runs/run-1/actions/revise-plan",
      expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
    );
  });

  it("getArtifacts and getEvents and getRunSkills hit their run-scoped endpoints", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));

    await api.getArtifacts("run-1");
    expect(fetch).toHaveBeenLastCalledWith("/api/runs/run-1/artifacts", { headers: {} });

    await api.getEvents("run-1");
    expect(fetch).toHaveBeenLastCalledWith("/api/runs/run-1/events", { headers: {} });

    await api.getRunSkills("run-1");
    expect(fetch).toHaveBeenLastCalledWith("/api/runs/run-1/skills", { headers: {} });
  });
});
