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

  describe("request() behavior via getRuns", () => {
    it("resolves with parsed JSON body on a successful response", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [{ id: "r1" }] }),
      );

      const result = await api.getRuns();

      expect(result).toEqual({ runs: [{ id: "r1" }] });
      expect(fetch).toHaveBeenCalledWith("/api/runs", expect.objectContaining({ headers: {} }));
    });

    it("appends the state query param when provided", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [] }),
      );

      await api.getRuns("Running");

      expect(fetch).toHaveBeenCalledWith(
        "/api/runs?state=Running",
        expect.anything(),
      );
    });

    it("throws an Error using the body's `error` field on a non-ok response", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Run not found" }, false, 404),
      );

      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to an `HTTP <status>` message when the error body has no `error` field", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({}, false, 500),
      );

      await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
    });

    it("falls back to an `HTTP <status>` message when the error body is not valid JSON", async () => {
      const res = {
        ok: false,
        status: 503,
        json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected end of JSON input")),
      } as unknown as Response;
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(res);

      await expect(api.getRun("r1")).rejects.toThrow("HTTP 503");
    });

    it("sets Content-Type header when a body is present, and omits it otherwise", async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "Running" }),
      );

      await api.approvePlan("run-1", "note");

      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/run-1/actions/approve-plan",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: "note" }),
        }),
      );
    });
  });

  describe("endpoint coverage", () => {
    beforeEach(() => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true }),
      );
    });

    it("getRun requests the run detail endpoint", async () => {
      await api.getRun("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1", expect.anything());
    });

    it("getRunSkills requests the skills endpoint", async () => {
      await api.getRunSkills("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/skills", expect.anything());
    });

    it("getArtifacts requests the artifacts endpoint", async () => {
      await api.getArtifacts("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", expect.anything());
    });

    it("getEvents requests the events endpoint", async () => {
      await api.getEvents("r1");
      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/events", expect.anything());
    });

    it("approvePlan omits the note when not provided", async () => {
      await api.approvePlan("r1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/approve-plan",
        expect.objectContaining({ body: JSON.stringify({ note: undefined }) }),
      );
    });

    it("rejectPlan defaults mode to 'iterate' and passes context", async () => {
      await api.rejectPlan("r1", "needs work");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/reject-plan",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ context: "needs work", mode: "iterate" }),
        }),
      );
    });

    it("rejectPlan passes through an explicit mode and omits context when absent", async () => {
      await api.rejectPlan("r1", undefined, "fresh");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/reject-plan",
        expect.objectContaining({
          body: JSON.stringify({ context: undefined, mode: "fresh" }),
        }),
      );
    });

    it("reReviewPlan posts to the re-review endpoint with an optional note", async () => {
      await api.reReviewPlan("r1", "fyi");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/re-review-plan",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ note: "fyi" }),
        }),
      );
    });

    it("reReviewPlan omits the note when not provided", async () => {
      await api.reReviewPlan("r1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/re-review-plan",
        expect.objectContaining({
          body: JSON.stringify({ note: undefined }),
        }),
      );
    });

    it("revisePlan posts to the revise endpoint", async () => {
      await api.revisePlan("r1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/revise-plan",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("approveReview posts with no body", async () => {
      await api.approveReview("r1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/approve-review",
        expect.objectContaining({ method: "POST" }),
      );
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/approve-review",
        expect.not.objectContaining({ body: expect.anything() }),
      );
    });

    it("pauseRun posts to the pause endpoint", async () => {
      await api.pauseRun("r1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/pause",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("resumeRun posts to the resume endpoint", async () => {
      await api.resumeRun("r1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/resume",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("retryStage posts to the retry endpoint", async () => {
      await api.retryStage("r1");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/retry",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("getActiveProcesses without a runId omits the query param", async () => {
      await api.getActiveProcesses();
      expect(fetch).toHaveBeenCalledWith("/api/processes", expect.anything());
    });

    it("getActiveProcesses with a runId appends the query param", async () => {
      await api.getActiveProcesses("r1");
      expect(fetch).toHaveBeenCalledWith("/api/processes?runId=r1", expect.anything());
    });

    it("getProcessOutput requests the process output endpoint", async () => {
      await api.getProcessOutput("p1");
      expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", expect.anything());
    });

    it("fetchPendingIssues requests the linear pending endpoint", async () => {
      await api.fetchPendingIssues();
      expect(fetch).toHaveBeenCalledWith("/api/linear/pending", expect.anything());
    });

    it("ingestIssues posts the issue id list", async () => {
      await api.ingestIssues(["a", "b"]);
      expect(fetch).toHaveBeenCalledWith(
        "/api/linear/ingest",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ issueIds: ["a", "b"] }),
        }),
      );
    });

    it("answerQuestions posts runId and the answers array", async () => {
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("r1", answers);
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/actions/answer-questions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ answers }),
        }),
      );
    });

    it("sendChatMessage posts the chat message", async () => {
      await api.sendChatMessage("r1", "hello");
      expect(fetch).toHaveBeenCalledWith(
        "/api/runs/r1/chat",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ message: "hello" }),
        }),
      );
    });
  });
});
