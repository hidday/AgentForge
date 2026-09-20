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

  it("getRuns issues a GET to /api/runs with no query string when no filter given", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns();
    expect(fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
  });

  it("getRuns appends the state query param when a filter is given", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns("Implementing");
    expect(fetch).toHaveBeenCalledWith("/api/runs?state=Implementing", { headers: {} });
  });

  it("getRuns resolves with the parsed JSON body on success", async () => {
    const runs = [{ id: "r1" }];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs }));
    const result = await api.getRuns();
    expect(result).toEqual({ runs });
  });

  it("getRun requests /api/runs/:id", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ run: {}, artifacts: [], events: [] }),
    );
    await api.getRun("run-1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1", { headers: {} });
  });

  it("getRunSkills requests /api/runs/:id/skills", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
    );
    await api.getRunSkills("run-1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/skills", { headers: {} });
  });

  it("getArtifacts requests /api/runs/:id/artifacts", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ artifacts: [] }));
    await api.getArtifacts("run-1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/artifacts", { headers: {} });
  });

  it("getEvents requests /api/runs/:id/events", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ events: [] }));
    await api.getEvents("run-1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/events", { headers: {} });
  });

  it("approvePlan POSTs a JSON body with an optional note, and sets Content-Type", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Done" }));
    await api.approvePlan("run-1", "lgtm");
    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "lgtm" }),
    });
  });

  it("approvePlan sends note: undefined when no note is passed", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Done" }));
    await api.approvePlan("run-1");
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({});
  });

  it("rejectPlan defaults mode to 'iterate' when not specified", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Todo" }));
    await api.rejectPlan("run-1", "needs work");
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ context: "needs work", mode: "iterate" });
  });

  it("rejectPlan forwards an explicit mode", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Todo" }));
    await api.rejectPlan("run-1", "start over", "fresh");
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ context: "start over", mode: "fresh" });
  });

  it("reReviewPlan POSTs to the re-review-plan action", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
    await api.reReviewPlan("run-1", "note");
    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/re-review-plan",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reReviewPlan sends note: undefined when no note is passed", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
    await api.reReviewPlan("run-1");
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({});
  });

  it("rejectPlan sends context: undefined when context is an empty string", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Todo" }));
    await api.rejectPlan("run-1", "", "fresh");
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ mode: "fresh" });
  });

  it("revisePlan POSTs to the revise-plan action", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));
    await api.revisePlan("run-1");
    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/revise-plan",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("approveReview POSTs with no body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "Done" }));
    await api.approveReview("run-1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-review", {
      headers: {},
      method: "POST",
    });
  });

  it("pauseRun POSTs to the pause action", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await api.pauseRun("run-1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/pause", {
      headers: {},
      method: "POST",
    });
  });

  it("resumeRun POSTs to the resume action", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await api.resumeRun("run-1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/resume", {
      headers: {},
      method: "POST",
    });
  });

  it("retryStage POSTs to the retry action", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Implementing", retrying: true }),
    );
    await api.retryStage("run-1");
    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/actions/retry", {
      headers: {},
      method: "POST",
    });
  });

  it("getActiveProcesses requests /api/processes with no query when runId omitted", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
    await api.getActiveProcesses();
    expect(fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
  });

  it("getActiveProcesses appends runId as a query param when given", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
    await api.getActiveProcesses("run-1");
    expect(fetch).toHaveBeenCalledWith("/api/processes?runId=run-1", { headers: {} });
  });

  it("getProcessOutput requests /api/processes/:id/output", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ processId: "p1", output: "log" }),
    );
    await api.getProcessOutput("p1");
    expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
  });

  it("fetchPendingIssues requests /api/linear/pending", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ issues: [] }));
    await api.fetchPendingIssues();
    expect(fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
  });

  it("ingestIssues POSTs the issueIds array", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, started: ["a"], skipped: [] }),
    );
    await api.ingestIssues(["a", "b"]);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ issueIds: ["a", "b"] });
  });

  it("answerQuestions POSTs the answers array", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, run: {} }));
    const answers = [{ questionId: "q1", answer: "42" }];
    await api.answerQuestions("run-1", answers);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ answers });
  });

  it("sendChatMessage POSTs the message and returns the reply", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ reply: "hi", durationMs: 10 }),
    );
    const result = await api.sendChatMessage("run-1", "hello");
    expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/chat", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
    });
    expect(result).toEqual({ reply: "hi", durationMs: 10 });
  });

  describe("error handling", () => {
    it("throws the server-provided error message on a non-ok response", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Run not found" }, false, 404),
      );
      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to an HTTP status message when the error body has no 'error' field", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));
      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to an HTTP status message when the error body is not valid JSON", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("invalid json")),
      } as unknown as Response);
      await expect(api.getRun("run-1")).rejects.toThrow("HTTP 503");
    });
  });
});
