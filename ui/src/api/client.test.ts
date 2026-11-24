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
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("getRuns issues a GET to /api/runs with no query string when no state is given", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/runs",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("getRuns appends ?state= when a state filter is given", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns("Done");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs?state=Done", expect.anything());
  });

  it("getRunSkills requests /api/runs/:id/skills", async () => {
    const body = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(body));
    const result = await api.getRunSkills("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/skills", expect.anything());
    expect(result).toEqual(body);
  });

  it("getArtifacts requests /api/runs/:id/artifacts", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ artifacts: [] }));
    await api.getArtifacts("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", expect.anything());
  });

  it("getEvents requests /api/runs/:id/events", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ events: [] }));
    await api.getEvents("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/events", expect.anything());
  });

  it("getRun requests /api/runs/:id and returns the parsed body", async () => {
    const body = { run: { id: "r1" }, artifacts: [], events: [] };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(body));
    const result = await api.getRun("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1", expect.anything());
    expect(result).toEqual(body);
  });

  it("approvePlan POSTs with a Content-Type header and JSON body containing the note", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Implementing" }),
    );
    await api.approvePlan("r1", "watch the migration");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "watch the migration" }),
    });
  });

  it("approvePlan omits the note field (sends undefined) when no note is passed", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Implementing" }),
    );
    await api.approvePlan("r1");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({});
  });

  it("rejectPlan defaults mode to 'iterate' when not specified", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Planning" }),
    );
    await api.rejectPlan("r1", "needs work");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ context: "needs work", mode: "iterate" });
  });

  it("rejectPlan forwards an explicit 'fresh' mode", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Planning" }),
    );
    await api.rejectPlan("r1", undefined, "fresh");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ mode: "fresh" });
  });

  it("pauseRun POSTs with no body and no Content-Type header", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await api.pauseRun("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/pause", {
      headers: {},
      method: "POST",
    });
  });

  it("getActiveProcesses omits the query string when no runId is given", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
    await api.getActiveProcesses();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes", expect.anything());
  });

  it("getActiveProcesses appends ?runId= when a runId is given", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
    await api.getActiveProcesses("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes?runId=r1", expect.anything());
  });

  it("ingestIssues sends the issueIds array as the POST body", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, started: ["a"], skipped: [] }),
    );
    await api.ingestIssues(["a", "b"]);
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ issueIds: ["a", "b"] });
  });

  it("throws an Error using the response body's 'error' field when the request fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "Run not found" }, false, 404),
    );
    await expect(api.getRun("missing")).rejects.toThrow("Run not found");
  });

  it("falls back to 'HTTP <status>' when the error body has no 'error' field", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));
    await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
  });

  it("falls back to 'HTTP <status>' when the error body is not valid JSON", async () => {
    const res = {
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error("invalid json")),
    } as unknown as Response;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res);
    await expect(api.getRun("r1")).rejects.toThrow("HTTP 503");
  });

  it("sendChatMessage posts the message and returns the reply payload", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ reply: "done", durationMs: 42 }),
    );
    const result = await api.sendChatMessage("r1", "hello");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/chat", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
    });
    expect(result).toEqual({ reply: "done", durationMs: 42 });
  });

  it("answerQuestions posts the answers array", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, run: {} }),
    );
    await api.answerQuestions("r1", [{ questionId: "q1", answer: "yes" }]);
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      answers: [{ questionId: "q1", answer: "yes" }],
    });
  });

  it("getProcessOutput requests the process output endpoint", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ processId: "p1", output: "log" }),
    );
    const result = await api.getProcessOutput("p1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/processes/p1/output", expect.anything());
    expect(result).toEqual({ processId: "p1", output: "log" });
  });

  it("retryStage POSTs to the retry endpoint", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Implementing", retrying: true }),
    );
    const result = await api.retryStage("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/retry", {
      headers: {},
      method: "POST",
    });
    expect(result.retrying).toBe(true);
  });

  it("reReviewPlan POSTs with the given note", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, runId: "r1" }),
    );
    await api.reReviewPlan("r1", "focus on tests");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/re-review-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "focus on tests" }),
    });
  });

  it("reReviewPlan omits the note field when none is given", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, runId: "r1" }),
    );
    await api.reReviewPlan("r1");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({});
  });

  it("revisePlan POSTs with the given note", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, runId: "r1" }),
    );
    await api.revisePlan("r1", "tighten rollout");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/revise-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "tighten rollout" }),
    });
  });

  it("revisePlan omits the note field when none is given", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, runId: "r1" }),
    );
    await api.revisePlan("r1");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({});
  });

  it("approveReview POSTs with no body", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Done" }),
    );
    await api.approveReview("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-review", {
      headers: {},
      method: "POST",
    });
  });

  it("resumeRun POSTs with no body", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await api.resumeRun("r1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/runs/r1/actions/resume", {
      headers: {},
      method: "POST",
    });
  });

  it("fetchPendingIssues requests the linear pending endpoint", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ issues: [] }),
    );
    await api.fetchPendingIssues();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
  });
});
