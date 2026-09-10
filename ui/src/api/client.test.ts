import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

describe("api client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockOk(body: unknown) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => body,
    });
  }

  function mockError(status: number, body: unknown) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status,
      json: async () => body,
    });
  }

  it("fetches runs without a state filter", async () => {
    mockOk({ runs: [] });
    await api.getRuns();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("fetches runs with a state filter appended as a query param", async () => {
    mockOk({ runs: [] });
    await api.getRuns("Planning");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs?state=Planning",
      expect.anything(),
    );
  });

  it("fetches a single run by id", async () => {
    const payload = { run: { id: "r1" }, artifacts: [], events: [] };
    mockOk(payload);
    const result = await api.getRun("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1", expect.anything());
    expect(result).toEqual(payload);
  });

  it("sends a JSON body and content-type header for POST requests", async () => {
    mockOk({ ok: true, state: "Implementing" });
    await api.approvePlan("r1", "looks good");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/approve-plan",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "looks good" }),
      }),
    );
  });

  it("omits the note field when approving a plan without one", async () => {
    mockOk({ ok: true, state: "Implementing" });
    await api.approvePlan("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/approve-plan",
      expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
    );
  });

  it("defaults rejectPlan's mode to iterate", async () => {
    mockOk({ ok: true, state: "Planning" });
    await api.rejectPlan("r1", "needs work");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/reject-plan",
      expect.objectContaining({
        body: JSON.stringify({ context: "needs work", mode: "iterate" }),
      }),
    );
  });

  it("omits an empty rejectPlan context and honors an explicit mode", async () => {
    mockOk({ ok: true, state: "Planning" });
    await api.rejectPlan("r1", "", "fresh");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/reject-plan",
      expect.objectContaining({
        body: JSON.stringify({ context: undefined, mode: "fresh" }),
      }),
    );
  });

  it("omits an empty reReviewPlan note", async () => {
    mockOk({ ok: true, runId: "r1" });
    await api.reReviewPlan("r1", "");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/re-review-plan",
      expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
    );
  });

  it("throws the server-provided error message on a non-ok response", async () => {
    mockError(400, { error: "Run not found" });
    await expect(api.getRun("missing")).rejects.toThrow("Run not found");
  });

  it("falls back to an HTTP status message when the error body has no message", async () => {
    mockError(500, {});
    await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
  });

  it("falls back to an HTTP status message when the error body isn't valid JSON", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("invalid json");
      },
    });
    await expect(api.getRun("r1")).rejects.toThrow("HTTP 502");
  });

  it("requests active processes scoped to a run when an id is given", async () => {
    mockOk({ processes: [] });
    await api.getActiveProcesses("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/processes?runId=r1",
      expect.anything(),
    );
  });

  it("requests all active processes when no run id is given", async () => {
    mockOk({ processes: [] });
    await api.getActiveProcesses();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes", expect.anything());
  });

  it("sends chat messages to the run's chat endpoint", async () => {
    mockOk({ reply: "hi", durationMs: 12 });
    const result = await api.sendChatMessage("r1", "hello");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs/r1/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ message: "hello" }),
      }),
    );
    expect(result).toEqual({ reply: "hi", durationMs: 12 });
  });

  it("sends issue ids when ingesting issues", async () => {
    mockOk({ ok: true, started: ["a"], skipped: [] });
    await api.ingestIssues(["a"]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/linear/ingest",
      expect.objectContaining({ body: JSON.stringify({ issueIds: ["a"] }) }),
    );
  });

  it("answers questions with the given answers array", async () => {
    mockOk({ ok: true, run: {} });
    await api.answerQuestions("r1", [{ questionId: "q1", answer: "yes" }]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/answer-questions",
      expect.objectContaining({
        body: JSON.stringify({ answers: [{ questionId: "q1", answer: "yes" }] }),
      }),
    );
  });

  it("fetches pending linear issues", async () => {
    mockOk({ issues: [] });
    await api.fetchPendingIssues();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
  });

  it("fetches artifacts and events for a run", async () => {
    mockOk({ artifacts: [] });
    await api.getArtifacts("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", expect.anything());

    mockOk({ events: [] });
    await api.getEvents("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/events", expect.anything());
  });

  it("pauses, resumes, and retries a run", async () => {
    mockOk({ ok: true });
    await api.pauseRun("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/pause",
      expect.objectContaining({ method: "POST" }),
    );

    mockOk({ ok: true });
    await api.resumeRun("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/resume",
      expect.objectContaining({ method: "POST" }),
    );

    mockOk({ ok: true, state: "Implementing", retrying: true });
    await api.retryStage("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/retry",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("re-reviews and revises a plan", async () => {
    mockOk({ ok: true, runId: "r1" });
    await api.reReviewPlan("r1", "note");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/re-review-plan",
      expect.objectContaining({ body: JSON.stringify({ note: "note" }) }),
    );

    mockOk({ ok: true, runId: "r1" });
    await api.revisePlan("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/revise-plan",
      expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
    );
  });

  it("approves a review and fetches process output", async () => {
    mockOk({ ok: true, state: "Done" });
    await api.approveReview("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/approve-review",
      expect.objectContaining({ method: "POST" }),
    );

    mockOk({ processId: "p1", output: "log output" });
    const result = await api.getProcessOutput("p1");
    expect(result).toEqual({ processId: "p1", output: "log output" });
  });

  it("fetches skills for a run", async () => {
    mockOk({ injectedSkills: [], distillationDecision: null, distilledSkill: null });
    const result = await api.getRunSkills("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/skills", expect.anything());
    expect(result.injectedSkills).toEqual([]);
  });
});
