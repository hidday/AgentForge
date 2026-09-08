import { describe, it, expect, vi, beforeEach } from "vitest";
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

  it("getRuns: builds the base URL with no query when no state filter is given", async () => {
    const runs = [{ id: "r1" }];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs }));

    const result = await api.getRuns();

    expect(fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
    expect(result).toEqual({ runs });
  });

  it("getRuns: appends the state filter as a query param when given", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns("Planning");
    expect(fetch).toHaveBeenCalledWith("/api/runs?state=Planning", { headers: {} });
  });

  it("getRun: requests the run detail endpoint by id", async () => {
    const payload = { run: { id: "r1" }, artifacts: [], events: [] };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));
    const result = await api.getRun("r1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/r1", { headers: {} });
    expect(result).toEqual(payload);
  });

  it("getRunSkills: requests the skills sub-resource", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
    );
    await api.getRunSkills("r1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/skills", { headers: {} });
  });

  it("getArtifacts: requests the artifacts sub-resource", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ artifacts: [] }));
    await api.getArtifacts("r1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", { headers: {} });
  });

  it("getEvents: requests the events sub-resource", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ events: [] }));
    await api.getEvents("r1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/events", { headers: {} });
  });

  it("approvePlan: POSTs with a note when provided, and sets JSON content-type header", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
    await api.approvePlan("r1", "looks good");
    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "looks good" }),
    });
  });

  it("approvePlan: omits the note (undefined) when not provided", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));
    await api.approvePlan("r1");
    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/approve-plan",
      expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
    );
  });

  it("rejectPlan: defaults mode to 'iterate' and omits empty context", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));
    await api.rejectPlan("r1");
    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/reject-plan",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ context: undefined, mode: "iterate" }),
      }),
    );
  });

  it("rejectPlan: passes through explicit context and mode", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Todo" }));
    await api.rejectPlan("r1", "start over", "fresh");
    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/reject-plan",
      expect.objectContaining({
        body: JSON.stringify({ context: "start over", mode: "fresh" }),
      }),
    );
  });

  it("reReviewPlan: POSTs with optional note", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
    await api.reReviewPlan("r1", "re-check");
    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/re-review-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "re-check" }),
    });
  });

  it("revisePlan: POSTs with optional note", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));
    await api.revisePlan("r1");
    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/revise-plan",
      expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
    );
  });

  it("approveReview: POSTs with no body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Done" }));
    await api.approveReview("r1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-review", {
      headers: {},
      method: "POST",
    });
  });

  it("pauseRun: POSTs with no body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await api.pauseRun("r1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/pause", { headers: {}, method: "POST" });
  });

  it("resumeRun: POSTs with no body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await api.resumeRun("r1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/resume", { headers: {}, method: "POST" });
  });

  it("retryStage: POSTs with no body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Implementing", retrying: true }),
    );
    await api.retryStage("r1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/retry", { headers: {}, method: "POST" });
  });

  it("getActiveProcesses: with no runId hits the base endpoint", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
    await api.getActiveProcesses();
    expect(fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
  });

  it("getActiveProcesses: with a runId appends it as a query param", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
    await api.getActiveProcesses("r1");
    expect(fetch).toHaveBeenCalledWith("/api/processes?runId=r1", { headers: {} });
  });

  it("getProcessOutput: requests the process output endpoint", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ processId: "p1", output: "hi" }),
    );
    await api.getProcessOutput("p1");
    expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
  });

  it("fetchPendingIssues: requests the pending linear issues endpoint", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ issues: [] }));
    await api.fetchPendingIssues();
    expect(fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
  });

  it("ingestIssues: POSTs the issue id list", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, started: ["a"], skipped: [] }),
    );
    await api.ingestIssues(["a", "b"]);
    expect(fetch).toHaveBeenCalledWith("/api/linear/ingest", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ issueIds: ["a", "b"] }),
    });
  });

  it("answerQuestions: POSTs the answers array", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, run: { id: "r1" } }),
    );
    const answers = [{ questionId: "q1", answer: "yes" }];
    await api.answerQuestions("r1", answers);
    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/answer-questions", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ answers }),
    });
  });

  it("sendChatMessage: POSTs the chat message", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ reply: "hi", durationMs: 10 }),
    );
    await api.sendChatMessage("r1", "hello");
    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/chat", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
    });
  });

  it("throws with the server-provided error message on a non-ok response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "Run not found" }, false, 404),
    );
    await expect(api.getRun("missing")).rejects.toThrow("Run not found");
  });

  it("falls back to an 'HTTP <status>' message when the error body has no error field", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));
    await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
  });

  it("falls back to an 'HTTP <status>' message when the error body isn't valid JSON", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error("invalid json")),
    } as unknown as Response);
    await expect(api.getRun("r1")).rejects.toThrow("HTTP 503");
  });

  it("propagates a network-level fetch rejection", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network down"));
    await expect(api.getRuns()).rejects.toThrow("Network down");
  });
});
