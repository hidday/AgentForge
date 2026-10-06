import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // GET requests: URL construction + parsing of successful responses
  // -------------------------------------------------------------------------

  it("getRuns() with no filter requests /api/runs and returns parsed runs", async () => {
    const payload = { runs: [{ id: "r1" }] };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

    const result = await api.getRuns();

    expect(fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
    expect(result).toEqual(payload);
  });

  it("getRuns(state) appends the state query param", async () => {
    const payload = { runs: [] };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

    await api.getRuns("Planning");

    expect(fetch).toHaveBeenCalledWith("/api/runs?state=Planning", { headers: {} });
  });

  it("getRun(id) requests /api/runs/:id", async () => {
    const payload = { run: { id: "r1" }, artifacts: [], events: [] };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

    const result = await api.getRun("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1", { headers: {} });
    expect(result).toEqual(payload);
  });

  it("getRunSkills(runId) requests /api/runs/:runId/skills", async () => {
    const payload = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

    const result = await api.getRunSkills("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/skills", { headers: {} });
    expect(result).toEqual(payload);
  });

  it("getArtifacts(runId) requests /api/runs/:runId/artifacts", async () => {
    const payload = { artifacts: [] };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

    await api.getArtifacts("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", { headers: {} });
  });

  it("getEvents(runId) requests /api/runs/:runId/events", async () => {
    const payload = { events: [] };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

    await api.getEvents("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/events", { headers: {} });
  });

  it("getActiveProcesses() with no runId omits the query param", async () => {
    const payload = { processes: [] };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

    await api.getActiveProcesses();

    expect(fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
  });

  it("getActiveProcesses(runId) appends the runId query param", async () => {
    const payload = { processes: [] };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

    await api.getActiveProcesses("r1");

    expect(fetch).toHaveBeenCalledWith("/api/processes?runId=r1", { headers: {} });
  });

  it("getProcessOutput(processId) requests /api/processes/:processId/output", async () => {
    const payload = { processId: "p1", output: "hello" };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

    const result = await api.getProcessOutput("p1");

    expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
    expect(result).toEqual(payload);
  });

  it("fetchPendingIssues() requests /api/linear/pending", async () => {
    const payload = { issues: [] };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

    await api.fetchPendingIssues();

    expect(fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
  });

  // -------------------------------------------------------------------------
  // POST requests: method, headers, and body construction
  // -------------------------------------------------------------------------

  it("approvePlan(runId, note) POSTs with Content-Type header and JSON body containing the note", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));

    await api.approvePlan("r1", "looks good");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "looks good" }),
    });
  });

  it("approvePlan(runId) with no note sends note: undefined in the body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));

    await api.approvePlan("r1");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(call[1].body as string)).toEqual({});
  });

  it("rejectPlan(runId, context, mode) sends context and mode in the body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));

    await api.rejectPlan("r1", "needs more detail", "fresh");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ context: "needs more detail", mode: "fresh" }),
    });
  });

  it("rejectPlan(runId) defaults mode to 'iterate' when omitted", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));

    await api.rejectPlan("r1");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(call[1].body as string)).toEqual({ mode: "iterate" });
  });

  it("reReviewPlan(runId, note) POSTs to the re-review-plan action", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

    await api.reReviewPlan("r1", "re-check");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/re-review-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "re-check" }),
    });
  });

  it("reReviewPlan(runId) with no note sends an empty body object", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

    await api.reReviewPlan("r1");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(call[1].body as string)).toEqual({});
  });

  it("revisePlan(runId, note) POSTs to the revise-plan action", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

    await api.revisePlan("r1", "please revise");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/revise-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "please revise" }),
    });
  });

  it("revisePlan(runId) with no note sends an empty body object", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

    await api.revisePlan("r1");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(call[1].body as string)).toEqual({});
  });

  it("approveReview(runId) POSTs with no body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Done" }));

    await api.approveReview("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-review", {
      headers: {},
      method: "POST",
    });
  });

  it("pauseRun(runId) POSTs with no body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

    await api.pauseRun("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/pause", { headers: {}, method: "POST" });
  });

  it("resumeRun(runId) POSTs with no body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

    await api.resumeRun("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/resume", { headers: {}, method: "POST" });
  });

  it("retryStage(runId) POSTs with no body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Implementing", retrying: true }),
    );

    const result = await api.retryStage("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/retry", { headers: {}, method: "POST" });
    expect(result).toEqual({ ok: true, state: "Implementing", retrying: true });
  });

  it("ingestIssues(issueIds) POSTs the issueIds array as the body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, started: ["i1"], skipped: [] }),
    );

    await api.ingestIssues(["i1", "i2"]);

    expect(fetch).toHaveBeenCalledWith("/api/linear/ingest", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ issueIds: ["i1", "i2"] }),
    });
  });

  it("answerQuestions(runId, answers) POSTs the answers array as the body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, run: { id: "r1" } }));

    const answers = [{ questionId: "q1", answer: "yes" }];
    await api.answerQuestions("r1", answers);

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/answer-questions", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ answers }),
    });
  });

  it("sendChatMessage(runId, message) POSTs the message and returns the reply", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ reply: "Hi there", durationMs: 42 }),
    );

    const result = await api.sendChatMessage("r1", "Hello?");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/chat", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ message: "Hello?" }),
    });
    expect(result).toEqual({ reply: "Hi there", durationMs: 42 });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it("throws an Error using the response's `error` field when the response is not ok", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "Run not found" }, false, 404),
    );

    await expect(api.getRun("missing")).rejects.toThrow("Run not found");
  });

  it("falls back to an 'HTTP <status>' message when the error body has no `error` field", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));

    await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
  });

  it("falls back to an 'HTTP <status>' message when the error body cannot be parsed as JSON", async () => {
    const res = {
      ok: false,
      status: 503,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response;
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res);

    await expect(api.getRun("r1")).rejects.toThrow("HTTP 503");
  });

  it("propagates a network error (rejected fetch) to the caller", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(api.getRuns()).rejects.toThrow("Failed to fetch");
  });
});
