import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonResponse(status: number, ok: boolean, body: unknown): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function rejectingJsonResponse(status: number, ok: boolean): Response {
  return {
    ok,
    status,
    json: () => Promise.reject(new Error("not json")),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// request() shaping behaviour, exercised through representative calls
// ---------------------------------------------------------------------------
describe("api client – request shaping", () => {
  it("issues a GET with no Content-Type header when there is no body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, true, { runs: [] }));
    await api.getRuns();

    expect(fetchMock).toHaveBeenCalledWith("/api/runs", { headers: {} });
  });

  it("issues a POST with a JSON Content-Type header when a body is present", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, true, { ok: true, state: "Implementing" }));
    await api.approvePlan("run-1", "looks good");

    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "looks good" }),
    });
  });

  it("resolves with the parsed JSON body on success", async () => {
    const payload = { runs: [{ id: "r1" }] };
    fetchMock.mockResolvedValue(jsonResponse(200, true, payload));
    const result = await api.getRuns();
    expect(result).toEqual(payload);
  });

  it("throws the server-provided error message on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, false, { error: "Bad request" }));
    await expect(api.getRuns()).rejects.toThrow("Bad request");
  });

  it("falls back to an HTTP status message when the error body has no `error` field", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, false, {}));
    await expect(api.getRuns()).rejects.toThrow("HTTP 500");
  });

  it("falls back to an HTTP status message when the error body isn't valid JSON", async () => {
    fetchMock.mockResolvedValue(rejectingJsonResponse(503, false));
    await expect(api.getRuns()).rejects.toThrow("HTTP 503");
  });

  it("propagates a network failure (fetch rejection)", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(api.getRuns()).rejects.toThrow("network down");
  });
});

// ---------------------------------------------------------------------------
// Individual endpoint functions: URL, method, and body construction
// ---------------------------------------------------------------------------
describe("api client – endpoint functions", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonResponse(200, true, {}));
  });

  it("getRuns() with no filter omits the query string", async () => {
    await api.getRuns();
    expect(fetchMock).toHaveBeenCalledWith("/api/runs", { headers: {} });
  });

  it("getRuns(state) appends the state query param", async () => {
    await api.getRuns("Implementing");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs?state=Implementing", { headers: {} });
  });

  it("getRun(id) fetches the run detail endpoint", async () => {
    await api.getRun("run-42");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-42", { headers: {} });
  });

  it("getRunSkills(runId) fetches the skills endpoint", async () => {
    await api.getRunSkills("run-42");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-42/skills", { headers: {} });
  });

  it("getArtifacts(runId) fetches the artifacts endpoint", async () => {
    await api.getArtifacts("run-42");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-42/artifacts", { headers: {} });
  });

  it("getEvents(runId) fetches the events endpoint", async () => {
    await api.getEvents("run-42");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-42/events", { headers: {} });
  });

  it("approvePlan(runId) omits note when not provided (undefined body field)", async () => {
    await api.approvePlan("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: undefined }),
    });
  });

  it("approvePlan(runId, note) includes the note", async () => {
    await api.approvePlan("run-1", "ship it");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/approve-plan",
      expect.objectContaining({ body: JSON.stringify({ note: "ship it" }) }),
    );
  });

  it("rejectPlan defaults mode to 'iterate' and omits context when not given", async () => {
    await api.rejectPlan("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/reject-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ context: undefined, mode: "iterate" }),
    });
  });

  it("rejectPlan forwards an explicit context and mode", async () => {
    await api.rejectPlan("run-1", "needs rework", "fresh");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/reject-plan",
      expect.objectContaining({
        body: JSON.stringify({ context: "needs rework", mode: "fresh" }),
      }),
    );
  });

  it("reReviewPlan(runId, note) posts to the re-review-plan endpoint", async () => {
    await api.reReviewPlan("run-1", "double-check");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/re-review-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: "double-check" }),
    });
  });

  it("reReviewPlan(runId) omits note when not provided", async () => {
    await api.reReviewPlan("run-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/re-review-plan",
      expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
    );
  });

  it("revisePlan(runId, note) posts to the revise-plan endpoint", async () => {
    await api.revisePlan("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/revise-plan", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ note: undefined }),
    });
  });

  it("approveReview(runId) posts with no body", async () => {
    await api.approveReview("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-review", {
      headers: {},
      method: "POST",
    });
  });

  it("pauseRun(runId) posts with no body", async () => {
    await api.pauseRun("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/pause", {
      headers: {},
      method: "POST",
    });
  });

  it("resumeRun(runId) posts with no body", async () => {
    await api.resumeRun("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/resume", {
      headers: {},
      method: "POST",
    });
  });

  it("retryStage(runId) posts with no body", async () => {
    await api.retryStage("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/retry", {
      headers: {},
      method: "POST",
    });
  });

  it("getActiveProcesses() with no runId omits the query string", async () => {
    await api.getActiveProcesses();
    expect(fetchMock).toHaveBeenCalledWith("/api/processes", { headers: {} });
  });

  it("getActiveProcesses(runId) appends the runId query param", async () => {
    await api.getActiveProcesses("run-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=run-1", { headers: {} });
  });

  it("getProcessOutput(processId) fetches the process output endpoint", async () => {
    await api.getProcessOutput("proc-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/processes/proc-1/output", { headers: {} });
  });

  it("fetchPendingIssues() fetches the linear pending endpoint", async () => {
    await api.fetchPendingIssues();
    expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
  });

  it("ingestIssues(issueIds) posts the issue id list", async () => {
    await api.ingestIssues(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/linear/ingest", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ issueIds: ["a", "b"] }),
    });
  });

  it("answerQuestions(runId, answers) posts the answers array", async () => {
    const answers = [{ questionId: "q1", answer: "yes" }];
    await api.answerQuestions("run-1", answers);
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/answer-questions", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ answers }),
    });
  });

  it("sendChatMessage(runId, message) posts the chat message", async () => {
    await api.sendChatMessage("run-1", "hello");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/chat", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
    });
  });
});
