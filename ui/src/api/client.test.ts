import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client";

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

  describe("getRuns", () => {
    it("requests /api/runs with no query string when no state given", async () => {
      const runs = [{ id: "r1" }];
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs }));

      const result = await api.getRuns();

      expect(fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
      expect(result).toEqual({ runs });
    });

    it("appends ?state= when a state filter is given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));

      await api.getRuns("Planning");

      expect(fetch).toHaveBeenCalledWith("/api/runs?state=Planning", { headers: {} });
    });
  });

  it("getRun requests /api/runs/:id and returns parsed body", async () => {
    const body = { run: { id: "r1" }, artifacts: [], events: [] };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(body));

    const result = await api.getRun("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1", { headers: {} });
    expect(result).toEqual(body);
  });

  it("getRunSkills requests /api/runs/:id/skills", async () => {
    const body = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(body));

    const result = await api.getRunSkills("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/skills", { headers: {} });
    expect(result).toEqual(body);
  });

  it("getArtifacts requests /api/runs/:id/artifacts", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ artifacts: [] }));

    await api.getArtifacts("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", { headers: {} });
  });

  it("getEvents requests /api/runs/:id/events", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ events: [] }));

    await api.getEvents("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/events", { headers: {} });
  });

  describe("approvePlan", () => {
    it("POSTs with a note when provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Implementing" }),
      );

      await api.approvePlan("r1", "looks good");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
    });

    it("sends note: undefined when no note is provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.approvePlan("r1");

      const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({});
    });
  });

  describe("rejectPlan", () => {
    it("defaults mode to 'iterate' when not specified", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.rejectPlan("r1");

      const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/r1/actions/reject-plan");
      expect(JSON.parse(init.body)).toEqual({ mode: "iterate" });
    });

    it("passes an explicit context and mode through", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.rejectPlan("r1", "needs rework", "fresh");

      const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ context: "needs rework", mode: "fresh" });
    });
  });

  it("reReviewPlan POSTs to the re-review-plan action", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

    await api.reReviewPlan("r1", "note");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/re-review-plan",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("revisePlan POSTs to the revise-plan action", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

    await api.revisePlan("r1");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/r1/actions/revise-plan",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("approveReview POSTs with no body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

    await api.approveReview("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-review", {
      headers: {},
      method: "POST",
    });
  });

  it("pauseRun POSTs to the pause action", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

    await api.pauseRun("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/pause", {
      headers: {},
      method: "POST",
    });
  });

  it("resumeRun POSTs to the resume action", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

    await api.resumeRun("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/resume", {
      headers: {},
      method: "POST",
    });
  });

  it("retryStage POSTs to the retry action", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "x", retrying: true }),
    );

    const result = await api.retryStage("r1");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/retry", {
      headers: {},
      method: "POST",
    });
    expect(result.retrying).toBe(true);
  });

  describe("getActiveProcesses", () => {
    it("requests /api/processes with no query string when runId omitted", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));

      await api.getActiveProcesses();

      expect(fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
    });

    it("appends ?runId= when provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));

      await api.getActiveProcesses("r1");

      expect(fetch).toHaveBeenCalledWith("/api/processes?runId=r1", { headers: {} });
    });
  });

  it("getProcessOutput requests /api/processes/:id/output", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ processId: "p1", output: "log" }),
    );

    const result = await api.getProcessOutput("p1");

    expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
    expect(result.output).toBe("log");
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

    expect(fetch).toHaveBeenCalledWith("/api/linear/ingest", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ issueIds: ["a", "b"] }),
    });
  });

  it("answerQuestions POSTs the answers array", async () => {
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

  it("sendChatMessage POSTs the message and returns the reply", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ reply: "hi there", durationMs: 42 }),
    );

    const result = await api.sendChatMessage("r1", "hello");

    expect(fetch).toHaveBeenCalledWith("/api/runs/r1/chat", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
    });
    expect(result).toEqual({ reply: "hi there", durationMs: 42 });
  });

  describe("error handling", () => {
    it("throws the server-provided error message on a non-ok response", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Run not found" }, false, 404),
      );

      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));

      await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error body isn't valid JSON", async () => {
      const badRes = {
        ok: false,
        status: 503,
        json: vi.fn().mockRejectedValue(new Error("not json")),
      } as unknown as Response;
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(badRes);

      await expect(api.getRun("r1")).rejects.toThrow("HTTP 503");
    });

    it("propagates a network failure (fetch rejecting)", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

      await expect(api.getRuns()).rejects.toThrow("network down");
    });
  });
});
