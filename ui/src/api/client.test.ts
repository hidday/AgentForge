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
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns the parsed JSON body on a successful response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ runs: [{ id: "run-1" }] }),
    );
    const result = await api.getRuns();
    expect(result).toEqual({ runs: [{ id: "run-1" }] });
  });

  it("builds the request URL without a query string when no state filter is passed", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns();
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/runs");
  });

  it("appends the state filter as a query string when provided", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns("Implementing");
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/runs?state=Implementing");
  });

  it("sends a GET-style request without a Content-Type header when there is no body", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await api.approveReview("run-1");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("sets the Content-Type header and serializes the body when a body is present", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Implementing" }),
    );
    await api.approvePlan("run-1", "looks good");
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/runs/run-1/actions/approve-plan");
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(options.body as string)).toEqual({ note: "looks good" });
  });

  it("omits the note from the body when approvePlan is called without one", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Implementing" }),
    );
    await api.approvePlan("run-1");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.parse(options.body as string)).toEqual({ note: undefined });
  });

  it("defaults rejectPlan's mode to 'iterate' when not specified", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Planning" }),
    );
    await api.rejectPlan("run-1", "needs work");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.parse(options.body as string)).toEqual({
      context: "needs work",
      mode: "iterate",
    });
  });

  it("omits context from the body when rejectPlan is called with an empty context", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Planning" }),
    );
    await api.rejectPlan("run-1");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.parse(options.body as string)).toEqual({
      context: undefined,
      mode: "iterate",
    });
  });

  it("passes through an explicit rejectPlan mode", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Planning" }),
    );
    await api.rejectPlan("run-1", "start over", "fresh");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.parse(options.body as string)).toEqual({
      context: "start over",
      mode: "fresh",
    });
  });

  it("sends the chat message body and path for sendChatMessage", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ reply: "hi", durationMs: 12 }),
    );
    const result = await api.sendChatMessage("run-1", "hello there");
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/runs/run-1/chat");
    expect(JSON.parse(options.body as string)).toEqual({ message: "hello there" });
    expect(result).toEqual({ reply: "hi", durationMs: 12 });
  });

  it("throws the server-provided error message on a non-ok JSON response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "run not found" }, false, 404),
    );
    await expect(api.getRun("missing")).rejects.toThrow("run not found");
  });

  it("falls back to a generic HTTP status error when the error body is unparsable", async () => {
    const res = {
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error("not json")),
    } as unknown as Response;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res);
    await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
  });

  it("falls back to a generic HTTP status error when the error body has no 'error' field", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: "nope" }, false, 400),
    );
    await expect(api.getRun("run-1")).rejects.toThrow("HTTP 400");
  });

  it("appends the runId query string for getActiveProcesses when provided", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ processes: [] }),
    );
    await api.getActiveProcesses("run-1");
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/processes?runId=run-1");
  });

  it("omits the query string for getActiveProcesses when no runId is given", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ processes: [] }),
    );
    await api.getActiveProcesses();
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/processes");
  });

  it("posts the issueIds array for ingestIssues", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, started: ["a"], skipped: [] }),
    );
    await api.ingestIssues(["a", "b"]);
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/linear/ingest");
    expect(JSON.parse(options.body as string)).toEqual({ issueIds: ["a", "b"] });
  });

  it("posts answers for answerQuestions", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, run: {} }),
    );
    const answers = [{ questionId: "q1", answer: "yes" }];
    await api.answerQuestions("run-1", answers);
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/runs/run-1/actions/answer-questions");
    expect(JSON.parse(options.body as string)).toEqual({ answers });
  });

  it("gets run skills by runId", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
    );
    const result = await api.getRunSkills("run-1");
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/runs/run-1/skills");
    expect(result).toEqual({
      injectedSkills: [],
      distillationDecision: null,
      distilledSkill: null,
    });
  });

  it("gets artifacts by runId", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ artifacts: [] }));
    await api.getArtifacts("run-1");
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/runs/run-1/artifacts");
  });

  it("gets events by runId", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ events: [] }));
    await api.getEvents("run-1");
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/runs/run-1/events");
  });

  it("posts the note for reReviewPlan", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, runId: "run-1" }),
    );
    await api.reReviewPlan("run-1", "re-check this");
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/runs/run-1/actions/re-review-plan");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({ note: "re-check this" });
  });

  it("omits the note from the body when reReviewPlan is called without one", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, runId: "run-1" }),
    );
    await api.reReviewPlan("run-1");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.parse(options.body as string)).toEqual({ note: undefined });
  });

  it("posts the note for revisePlan", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, runId: "run-1" }),
    );
    await api.revisePlan("run-1", "revise this");
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/runs/run-1/actions/revise-plan");
    expect(JSON.parse(options.body as string)).toEqual({ note: "revise this" });
  });

  it("omits the note from the body when revisePlan is called without one", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, runId: "run-1" }),
    );
    await api.revisePlan("run-1");
    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.parse(options.body as string)).toEqual({ note: undefined });
  });

  it("posts to approveReview with no body", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Reviewing" }),
    );
    await api.approveReview("run-1");
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/runs/run-1/actions/approve-review");
    expect(options.method).toBe("POST");
    expect(options.body).toBeUndefined();
  });

  it("posts to pauseRun with no body", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await api.pauseRun("run-1");
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/runs/run-1/actions/pause");
    expect(options.method).toBe("POST");
  });

  it("posts to resumeRun with no body", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await api.resumeRun("run-1");
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/runs/run-1/actions/resume");
    expect(options.method).toBe("POST");
  });

  it("posts to retryStage and returns the retrying flag", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Implementing", retrying: true }),
    );
    const result = await api.retryStage("run-1");
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/runs/run-1/actions/retry");
    expect(options.method).toBe("POST");
    expect(result).toEqual({ ok: true, state: "Implementing", retrying: true });
  });

  it("gets process output by processId", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ processId: "proc-1", output: "log line" }),
    );
    const result = await api.getProcessOutput("proc-1");
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/processes/proc-1/output");
    expect(result).toEqual({ processId: "proc-1", output: "log line" });
  });

  it("fetches pending linear issues", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ issues: [] }));
    await api.fetchPendingIssues();
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/linear/pending");
  });
});
