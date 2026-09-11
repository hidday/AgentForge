import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("request() shared behavior (via getRuns)", () => {
    it("builds the correct URL with no query params and uses GET with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));

      await api.getRuns();

      expect(fetch).toHaveBeenCalledWith("/api/runs", { headers: {} });
    });

    it("appends the state query param when provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));

      await api.getRuns("running");

      expect(fetch).toHaveBeenCalledWith("/api/runs?state=running", { headers: {} });
    });

    it("resolves with the parsed JSON body on success", async () => {
      const runs = [{ id: "r1" }];
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs }));

      const result = await api.getRuns();

      expect(result).toEqual({ runs });
    });

    it("throws the server-provided error message on a non-ok response", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Run not found" }, { ok: false, status: 404 }),
      );

      await expect(api.getRuns()).rejects.toThrow("Run not found");
    });

    it("falls back to an HTTP status message when the error body has no error field", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({}, { ok: false, status: 500 }),
      );

      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("falls back to an HTTP status message when the error body is malformed JSON", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
      } as unknown as Response);

      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });

    it("propagates a network-level rejection", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(api.getRuns()).rejects.toThrow("Failed to fetch");
    });
  });

  describe("getRun", () => {
    it("requests the run detail endpoint for the given id", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ run: { id: "r1" }, artifacts: [], events: [] }),
      );

      const result = await api.getRun("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1", { headers: {} });
      expect(result).toEqual({ run: { id: "r1" }, artifacts: [], events: [] });
    });
  });

  describe("getRunSkills", () => {
    it("requests the skills endpoint for the given run id", async () => {
      const response = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(response));

      const result = await api.getRunSkills("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/skills", { headers: {} });
      expect(result).toEqual(response);
    });
  });

  describe("getArtifacts", () => {
    it("requests the artifacts endpoint for the given run id", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ artifacts: [] }));

      const result = await api.getArtifacts("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/artifacts", { headers: {} });
      expect(result).toEqual({ artifacts: [] });
    });
  });

  describe("getEvents", () => {
    it("requests the events endpoint for the given run id", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ events: [] }));

      const result = await api.getEvents("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/events", { headers: {} });
      expect(result).toEqual({ events: [] });
    });
  });

  describe("approvePlan", () => {
    it("posts a note when one is given, with a JSON content-type header", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.approvePlan("r1", "looks good");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
    });

    it("omits the note field when none is given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.approvePlan("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("rejectPlan", () => {
    it("posts context and mode when both are given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.rejectPlan("r1", "needs more detail", "fresh");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: "needs more detail", mode: "fresh" }),
      });
    });

    it("defaults mode to iterate and omits context when neither is given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.rejectPlan("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: undefined, mode: "iterate" }),
      });
    });
  });

  describe("reReviewPlan", () => {
    it("posts the given note", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

      await api.reReviewPlan("r1", "re-check this");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "re-check this" }),
      });
    });

    it("omits the note when none is given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

      await api.reReviewPlan("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("revisePlan", () => {
    it("posts the given note", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

      await api.revisePlan("r1", "please revise");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "please revise" }),
      });
    });

    it("omits the note when none is given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, runId: "r1" }));

      await api.revisePlan("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: undefined }),
      });
    });
  });

  describe("approveReview", () => {
    it("posts with no body and no content-type header", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.approveReview("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
    });
  });

  describe("pauseRun", () => {
    it("posts with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

      await api.pauseRun("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/pause", {
        headers: {},
        method: "POST",
      });
    });
  });

  describe("resumeRun", () => {
    it("posts with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

      await api.resumeRun("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/resume", {
        headers: {},
        method: "POST",
      });
    });
  });

  describe("retryStage", () => {
    it("posts with no body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "x", retrying: true }),
      );

      const result = await api.retryStage("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/retry", {
        headers: {},
        method: "POST",
      });
      expect(result).toEqual({ ok: true, state: "x", retrying: true });
    });
  });

  describe("getActiveProcesses", () => {
    it("requests without a runId filter when none is given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));

      await api.getActiveProcesses();

      expect(fetch).toHaveBeenCalledWith("/api/processes", { headers: {} });
    });

    it("appends the runId query param when given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));

      await api.getActiveProcesses("r1");

      expect(fetch).toHaveBeenCalledWith("/api/processes?runId=r1", { headers: {} });
    });
  });

  describe("getProcessOutput", () => {
    it("requests the output for a given process id", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ processId: "p1", output: "hello" }),
      );

      const result = await api.getProcessOutput("p1");

      expect(fetch).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
      expect(result).toEqual({ processId: "p1", output: "hello" });
    });
  });

  describe("fetchPendingIssues", () => {
    it("requests the pending linear issues endpoint", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ issues: [] }));

      const result = await api.fetchPendingIssues();

      expect(fetch).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
      expect(result).toEqual({ issues: [] });
    });
  });

  describe("ingestIssues", () => {
    it("posts the given issue ids", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, started: ["i1"], skipped: [] }),
      );

      const result = await api.ingestIssues(["i1", "i2"]);

      expect(fetch).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["i1", "i2"] }),
      });
      expect(result).toEqual({ ok: true, started: ["i1"], skipped: [] });
    });
  });

  describe("answerQuestions", () => {
    it("posts the given answers for a run", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, run: {} }));

      const answers = [{ questionId: "q1", answer: "a1" }];
      await api.answerQuestions("r1", answers);

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/actions/answer-questions", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ answers }),
      });
    });
  });

  describe("sendChatMessage", () => {
    it("posts the chat message for a run", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ reply: "hi", durationMs: 12 }),
      );

      const result = await api.sendChatMessage("r1", "hello there");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "hello there" }),
      });
      expect(result).toEqual({ reply: "hi", durationMs: 12 });
    });
  });
});
