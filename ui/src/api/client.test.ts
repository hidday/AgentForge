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
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("request building", () => {
    it("builds a GET request to the correct URL with no body/content-type header", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [] }),
      );

      await api.getRuns();

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs");
      expect(options.headers).toEqual({});
      expect(options.method).toBeUndefined();
    });

    it("appends the state query param when provided to getRuns", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [] }),
      );

      await api.getRuns("running");

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs?state=running");
    });

    it("omits the query param when state is not provided", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [] }),
      );

      await api.getRuns(undefined);

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs");
    });

    it("builds a GET request for a single run by id", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ run: {}, artifacts: [], events: [] }),
      );

      await api.getRun("run-123");

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-123");
    });

    it("sends a POST with JSON body and Content-Type header for approvePlan", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "approved" }),
      );

      await api.approvePlan("run-1", "looks good");

      const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/approve-plan");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(options.body)).toEqual({ note: "looks good" });
    });

    it("serializes undefined note as undefined (omitted) when note is empty", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "approved" }),
      );

      await api.approvePlan("run-1");

      const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsed = JSON.parse(options.body);
      expect(parsed).toEqual({});
    });

    it("defaults rejectPlan mode to 'iterate' when not provided", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "rejected" }),
      );

      await api.rejectPlan("run-1");

      const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/reject-plan");
      const parsed = JSON.parse(options.body);
      expect(parsed).toEqual({ context: undefined, mode: "iterate" });
    });

    it("passes an explicit rejectPlan mode through", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "rejected" }),
      );

      await api.rejectPlan("run-1", "needs rework", "fresh");

      const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsed = JSON.parse(options.body);
      expect(parsed).toEqual({ context: "needs rework", mode: "fresh" });
    });

    it("builds a POST request with no body for approveReview", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, state: "approved" }),
      );

      await api.approveReview("run-1");

      const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/approve-review");
      expect(options.method).toBe("POST");
      // no body supplied -> no Content-Type header added
      expect(options.headers).toEqual({});
      expect(options.body).toBeUndefined();
    });

    it("builds getActiveProcesses URL with runId query param when provided", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ processes: [] }),
      );

      await api.getActiveProcesses("run-9");

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/processes?runId=run-9");
    });

    it("builds getActiveProcesses URL without query param when runId omitted", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ processes: [] }),
      );

      await api.getActiveProcesses();

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/processes");
    });

    it("builds ingestIssues POST request with issueIds array in body", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, started: [], skipped: [] }),
      );

      await api.ingestIssues(["a", "b"]);

      const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/linear/ingest");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({ issueIds: ["a", "b"] });
    });

    it("builds answerQuestions POST request with answers array in body", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, run: {} }),
      );

      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("run-1", answers);

      const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/actions/answer-questions");
      expect(JSON.parse(options.body)).toEqual({ answers });
    });

    it("builds sendChatMessage POST request with message in body", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ reply: "hi", durationMs: 1 }),
      );

      await api.sendChatMessage("run-1", "hello there");

      const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/runs/run-1/chat");
      expect(JSON.parse(options.body)).toEqual({ message: "hello there" });
    });

    it("builds getRunSkills, getArtifacts, getEvents, getProcessOutput, and fetchPendingIssues URLs", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));

      await api.getRunSkills("run-5");
      await api.getArtifacts("run-5");
      await api.getEvents("run-5");
      await api.getProcessOutput("proc-1");
      await api.fetchPendingIssues();

      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(calls).toEqual([
        "/api/runs/run-5/skills",
        "/api/runs/run-5/artifacts",
        "/api/runs/run-5/events",
        "/api/processes/proc-1/output",
        "/api/linear/pending",
      ]);
    });
  });

  describe("success response parsing", () => {
    it("resolves with the parsed JSON body on success", async () => {
      const payload = { runs: [{ id: "r1" }] };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.getRuns();

      expect(result).toEqual(payload);
    });

    it("resolves retryStage with ok/state/retrying fields", async () => {
      const payload = { ok: true, state: "executing", retrying: true };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.retryStage("run-1");

      expect(result).toEqual(payload);
    });
  });

  describe("error handling", () => {
    it("throws an Error using the server-provided error message on non-2xx status", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Run not found" }, false, 404),
      );

      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({}, false, 500),
      );

      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error body is not valid JSON", async () => {
      const res = {
        ok: false,
        status: 503,
        json: async () => {
          throw new Error("invalid json");
        },
      } as unknown as Response;
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res);

      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });

    it("propagates a network failure (fetch rejecting) as a thrown error", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Network down"),
      );

      await expect(api.getRuns()).rejects.toThrow("Network down");
    });
  });
});
