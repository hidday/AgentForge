import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the runs list without a query string when no filter is given", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns();
    expect(fetch).toHaveBeenCalledWith("/api/runs", expect.objectContaining({ headers: {} }));
  });

  it("GETs the runs list with a state query string when a filter is given", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns("Done");
    expect(fetch).toHaveBeenCalledWith("/api/runs?state=Done", expect.anything());
  });

  it("GETs a single run by id", async () => {
    const payload = { run: {}, artifacts: [], events: [] };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));
    const result = await api.getRun("run-1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1", expect.anything());
    expect(result).toEqual(payload);
  });

  it("POSTs JSON bodies with a Content-Type header for mutating actions", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Done" }));
    await api.approvePlan("run-1", "looks good");

    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "looks good" }),
    });
  });

  it("omits the note field when approving a plan with no note", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Done" }));
    await api.approvePlan("run-1");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/approve-plan",
      expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
    );
  });

  it("defaults rejectPlan's mode to 'iterate'", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Planning" }));
    await api.rejectPlan("run-1", "needs work");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/reject-plan",
      expect.objectContaining({
        body: JSON.stringify({ context: "needs work", mode: "iterate" }),
      }),
    );
  });

  it("sends POST requests with no body for parameterless actions", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await api.pauseRun("run-1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/pause", {
      headers: {},
      method: "POST",
    });
  });

  it("sends the chat message body on sendChatMessage", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ reply: "hi", durationMs: 10 }),
    );
    const result = await api.sendChatMessage("run-1", "hello agent");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/chat",
      expect.objectContaining({ body: JSON.stringify({ message: "hello agent" }) }),
    );
    expect(result).toEqual({ reply: "hi", durationMs: 10 });
  });

  it("throws the server-provided error message when a request fails", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "Run not found" }, false, 404),
    );

    await expect(api.getRun("missing")).rejects.toThrow("Run not found");
  });

  it("falls back to an HTTP status message when the error body has no error field", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));

    await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
  });

  it("falls back to an HTTP status message when the error body fails to parse", async () => {
    const res = {
      ok: false,
      status: 503,
      json: vi.fn().mockRejectedValue(new Error("not json")),
    } as unknown as Response;
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res);

    await expect(api.getRun("run-1")).rejects.toThrow("HTTP 503");
  });

  it("includes issueIds in the ingestIssues request body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, started: ["a"], skipped: [] }),
    );
    await api.ingestIssues(["a", "b"]);

    expect(fetch).toHaveBeenCalledWith(
      "/api/linear/ingest",
      expect.objectContaining({ body: JSON.stringify({ issueIds: ["a", "b"] }) }),
    );
  });

  it("includes answers in the answerQuestions request body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, run: {} }));
    const answers = [{ questionId: "q1", answer: "42" }];
    await api.answerQuestions("run-1", answers);

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/answer-questions",
      expect.objectContaining({ body: JSON.stringify({ answers }) }),
    );
  });

  it("GETs run skills for a run", async () => {
    const payload = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));
    const result = await api.getRunSkills("run-1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/skills", expect.anything());
    expect(result).toEqual(payload);
  });

  it("GETs artifacts for a run", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ artifacts: [] }));
    await api.getArtifacts("run-1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/artifacts", expect.anything());
  });

  it("GETs events for a run", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ events: [] }));
    await api.getEvents("run-1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/events", expect.anything());
  });

  it("rejectPlan sends mode 'fresh' and omits context when none is given", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Planning" }));
    await api.rejectPlan("run-1", undefined, "fresh");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/reject-plan",
      expect.objectContaining({
        body: JSON.stringify({ context: undefined, mode: "fresh" }),
      }),
    );
  });

  it("sends the note body on reReviewPlan", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
    await api.reReviewPlan("run-1", "re-check this");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/re-review-plan",
      expect.objectContaining({ body: JSON.stringify({ note: "re-check this" }) }),
    );
  });

  it("omits the note field when re-reviewing a plan with no note", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
    await api.reReviewPlan("run-1");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/re-review-plan",
      expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
    );
  });

  it("sends the note body on revisePlan", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
    await api.revisePlan("run-1", "revise this");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/revise-plan",
      expect.objectContaining({ body: JSON.stringify({ note: "revise this" }) }),
    );
  });

  it("omits the note field when revising a plan with no note", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
    await api.revisePlan("run-1");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/revise-plan",
      expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
    );
  });

  it("POSTs approveReview with no body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Executing" }));
    await api.approveReview("run-1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-review", {
      headers: {},
      method: "POST",
    });
  });

  it("POSTs resumeRun with no body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await api.resumeRun("run-1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/resume", {
      headers: {},
      method: "POST",
    });
  });

  it("POSTs retryStage and returns the retrying flag", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Executing", retrying: true }),
    );
    const result = await api.retryStage("run-1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/retry", {
      headers: {},
      method: "POST",
    });
    expect(result).toEqual({ ok: true, state: "Executing", retrying: true });
  });

  it("GETs process output by processId", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ processId: "p1", output: "log line" }),
    );
    const result = await api.getProcessOutput("p1");

    expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", expect.anything());
    expect(result).toEqual({ processId: "p1", output: "log line" });
  });

  it("GETs pending Linear issues", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ issues: [] }));
    await api.fetchPendingIssues();
    expect(fetch).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
  });

  it("GETs active processes scoped to a runId when provided", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
    await api.getActiveProcesses("run-1");
    expect(fetch).toHaveBeenCalledWith("/api/processes?runId=run-1", expect.anything());
  });

  it("GETs all active processes when no runId is provided", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
    await api.getActiveProcesses();
    expect(fetch).toHaveBeenCalledWith("/api/processes", expect.anything());
  });
});
