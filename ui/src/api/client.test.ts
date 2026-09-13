import { describe, it, expect, vi, beforeEach } from "vitest";
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

  describe("request() plumbing (exercised via api.getRuns / api.approvePlan)", () => {
    it("issues a GET with no Content-Type header when there is no body", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));

      const result = await api.getRuns();

      expect(fetchMock).toHaveBeenCalledWith("/api/runs", { headers: {} });
      expect(result).toEqual({ runs: [] });
    });

    it("appends a state query param when provided", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));

      await api.getRuns("Planning");

      expect(fetchMock).toHaveBeenCalledWith("/api/runs?state=Planning", { headers: {} });
    });

    it("sets Content-Type: application/json and forwards method/body when a body is present", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));

      await api.approvePlan("run-1", "looks good");

      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
    });

    it("throws the server-provided error message when the response is not ok", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse({ error: "Run not found" }, false, 404));

      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500));

      await expect(api.getRun("broken")).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error body fails to parse as JSON", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const res = {
        ok: false,
        status: 503,
        json: vi.fn().mockRejectedValue(new Error("not json")),
      } as unknown as Response;
      fetchMock.mockResolvedValue(res);

      await expect(api.getRun("broken")).rejects.toThrow("HTTP 503");
    });

    it("propagates a network-level rejection (fetch itself throws)", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockRejectedValue(new Error("network down"));

      await expect(api.getRun("run-1")).rejects.toThrow("network down");
    });
  });

  it("getRun requests /runs/:id and returns the parsed payload", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const payload = { run: { id: "run-1" }, artifacts: [], events: [] };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const result = await api.getRun("run-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1", { headers: {} });
    expect(result).toEqual(payload);
  });

  it("getRunSkills requests /runs/:id/skills", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const payload = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const result = await api.getRunSkills("run-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/skills", { headers: {} });
    expect(result).toEqual(payload);
  });

  it("getArtifacts requests /runs/:id/artifacts", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ artifacts: [] }));

    await api.getArtifacts("run-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/artifacts", { headers: {} });
  });

  it("getEvents requests /runs/:id/events", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ events: [] }));

    await api.getEvents("run-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/events", { headers: {} });
  });

  it("approvePlan omits the note field when no note is given", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));

    await api.approvePlan("run-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: undefined }),
    });
  });

  it("rejectPlan defaults mode to 'iterate' and omits context when not given", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "PlanRevision" }));

    await api.rejectPlan("run-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/reject-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ context: undefined, mode: "iterate" }),
    });
  });

  it("rejectPlan forwards an explicit context and mode", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Planning" }));

    await api.rejectPlan("run-1", "start over", "fresh");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/reject-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ context: "start over", mode: "fresh" }),
    });
  });

  it("reReviewPlan posts an optional note", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));

    await api.reReviewPlan("run-1", "double check");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/re-review-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "double check" }),
    });
  });

  it("revisePlan posts an optional note", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, runId: "run-1" }));

    await api.revisePlan("run-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/revise-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: undefined }),
    });
  });

  it("approveReview posts with no body and no Content-Type header", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing" }));

    await api.approveReview("run-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-review", {
      headers: {},
      method: "POST",
    });
  });

  it("pauseRun posts to /runs/:id/actions/pause", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.pauseRun("run-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/pause", {
      headers: {},
      method: "POST",
    });
  });

  it("resumeRun posts to /runs/:id/actions/resume", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await api.resumeRun("run-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/resume", {
      headers: {},
      method: "POST",
    });
  });

  it("retryStage posts to /runs/:id/actions/retry", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, state: "Implementing", retrying: true }));

    const result = await api.retryStage("run-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/retry", {
      headers: {},
      method: "POST",
    });
    expect(result).toEqual({ ok: true, state: "Implementing", retrying: true });
  });

  it("getActiveProcesses requests /processes with no query when runId is omitted", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));

    await api.getActiveProcesses();

    expect(fetchMock).toHaveBeenCalledWith("/api/processes", { headers: {} });
  });

  it("getActiveProcesses appends ?runId= when provided", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ processes: [] }));

    await api.getActiveProcesses("run-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=run-1", { headers: {} });
  });

  it("getProcessOutput requests /processes/:id/output", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ processId: "p1", output: "log line" }));

    const result = await api.getProcessOutput("p1");

    expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
    expect(result).toEqual({ processId: "p1", output: "log line" });
  });

  it("fetchPendingIssues requests /linear/pending", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ issues: [] }));

    await api.fetchPendingIssues();

    expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
  });

  it("ingestIssues posts the issue id list", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, started: ["a"], skipped: [] }));

    await api.ingestIssues(["a", "b"]);

    expect(fetchMock).toHaveBeenCalledWith("/api/linear/ingest", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ issueIds: ["a", "b"] }),
    });
  });

  it("answerQuestions posts the run id and answers", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, run: { id: "run-1" } }));

    const answers = [{ questionId: "q1", answer: "yes" }];
    await api.answerQuestions("run-1", answers);

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/answer-questions", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ answers }),
    });
  });

  it("sendChatMessage posts the message and returns the reply payload", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ reply: "hi there", durationMs: 42 }));

    const result = await api.sendChatMessage("run-1", "hello");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/chat", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
    });
    expect(result).toEqual({ reply: "hi there", durationMs: 42 });
  });
});
