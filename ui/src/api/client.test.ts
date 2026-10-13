import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./client.ts";

type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function makeResponse(
  ok: boolean,
  status: number,
  body: unknown,
  jsonImpl?: () => Promise<unknown>,
): FakeResponse {
  return {
    ok,
    status,
    json: jsonImpl ?? (() => Promise.resolve(body)),
  };
}

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("request() shared behavior", () => {
    it("sends GET requests with no Content-Type header when there is no body", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { runs: [] }));

      await api.getRuns();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs");
      expect(options.headers).toEqual({});
      expect(options.method).toBeUndefined();
    });

    it("sends POST requests with a JSON Content-Type header and a JSON body", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { ok: true, state: "approved" }));

      await api.approvePlan("run-1", "looks good");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/approve-plan");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({ "Content-Type": "application/json" });
      expect(options.body).toBe(JSON.stringify({ note: "looks good" }));
    });

    it("resolves with the parsed JSON body on a successful response", async () => {
      const payload = { runs: [{ id: "r1" }] };
      fetchMock.mockResolvedValue(makeResponse(true, 200, payload));

      const result = await api.getRuns();

      expect(result).toEqual(payload);
    });

    it("throws the server-provided error message on a non-2xx response", async () => {
      fetchMock.mockResolvedValue(
        makeResponse(false, 400, { error: "Invalid run state" }),
      );

      await expect(api.getRuns()).rejects.toThrow("Invalid run state");
    });

    it("falls back to an HTTP status error when the error body has no 'error' field", async () => {
      fetchMock.mockResolvedValue(makeResponse(false, 500, {}));

      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("falls back to an HTTP status error when the error body is not valid JSON", async () => {
      fetchMock.mockResolvedValue(
        makeResponse(false, 503, undefined, () => Promise.reject(new Error("bad json"))),
      );

      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });

    it("propagates a network failure when fetch itself rejects", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

      await expect(api.getRuns()).rejects.toThrow("Failed to fetch");
    });

    it("rejects when the successful response body is malformed JSON", async () => {
      fetchMock.mockResolvedValue(
        makeResponse(true, 200, undefined, () => Promise.reject(new SyntaxError("Unexpected token"))),
      );

      await expect(api.getRuns()).rejects.toThrow("Unexpected token");
    });
  });

  describe("getRuns", () => {
    it("requests /runs without a query string when no state filter is given", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { runs: [] }));
      await api.getRuns();
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs");
    });

    it("requests /runs?state=... when a state filter is given", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { runs: [] }));
      await api.getRuns("active");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs?state=active");
    });
  });

  describe("getRun", () => {
    it("requests /runs/:id and returns run, artifacts and events", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      fetchMock.mockResolvedValue(makeResponse(true, 200, payload));

      const result = await api.getRun("r1");

      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r1");
      expect(result).toEqual(payload);
    });
  });

  describe("getRunSkills", () => {
    it("requests /runs/:id/skills", async () => {
      const payload = { injectedSkills: [], distillationDecision: null, distilledSkill: null };
      fetchMock.mockResolvedValue(makeResponse(true, 200, payload));

      const result = await api.getRunSkills("r1");

      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r1/skills");
      expect(result).toEqual(payload);
    });
  });

  describe("getArtifacts", () => {
    it("requests /runs/:id/artifacts", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { artifacts: [] }));
      await api.getArtifacts("r1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r1/artifacts");
    });
  });

  describe("getEvents", () => {
    it("requests /runs/:id/events", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { events: [] }));
      await api.getEvents("r1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/runs/r1/events");
    });
  });

  describe("approvePlan", () => {
    it("sends a note when provided", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { ok: true, state: "x" }));
      await api.approvePlan("r1", "note here");
      const [, options] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(options.body)).toEqual({ note: "note here" });
    });

    it("sends note: undefined when no note is provided", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { ok: true, state: "x" }));
      await api.approvePlan("r1");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/approve-plan");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({});
    });
  });

  describe("rejectPlan", () => {
    it("defaults mode to 'iterate' when not given", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { ok: true, state: "x" }));
      await api.rejectPlan("r1", "ctx");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/reject-plan");
      expect(JSON.parse(options.body)).toEqual({ context: "ctx", mode: "iterate" });
    });

    it("sends the provided mode and omits context when not given", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { ok: true, state: "x" }));
      await api.rejectPlan("r1", undefined, "fresh");
      const [, options] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(options.body)).toEqual({ mode: "fresh" });
    });
  });

  describe("reReviewPlan", () => {
    it("posts to /runs/:id/actions/re-review-plan with a note", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { ok: true, runId: "r1" }));
      await api.reReviewPlan("r1", "n");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/re-review-plan");
      expect(JSON.parse(options.body)).toEqual({ note: "n" });
    });

    it("omits the note when none is provided", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { ok: true, runId: "r1" }));
      await api.reReviewPlan("r1");
      const [, options] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(options.body)).toEqual({});
    });
  });

  describe("revisePlan", () => {
    it("posts to /runs/:id/actions/revise-plan with a note", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { ok: true, runId: "r1" }));
      await api.revisePlan("r1", "n");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/revise-plan");
      expect(JSON.parse(options.body)).toEqual({ note: "n" });
    });

    it("omits the note when none is provided", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { ok: true, runId: "r1" }));
      await api.revisePlan("r1");
      const [, options] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(options.body)).toEqual({});
    });
  });

  describe("approveReview", () => {
    it("posts to /runs/:id/actions/approve-review with no body", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { ok: true, state: "x" }));
      await api.approveReview("r1");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/approve-review");
      expect(options.method).toBe("POST");
      expect(options.body).toBeUndefined();
      expect(options.headers).toEqual({});
    });
  });

  describe("pauseRun", () => {
    it("posts to /runs/:id/actions/pause", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { ok: true }));
      await api.pauseRun("r1");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/pause");
      expect(options.method).toBe("POST");
    });
  });

  describe("resumeRun", () => {
    it("posts to /runs/:id/actions/resume", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { ok: true }));
      await api.resumeRun("r1");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/resume");
      expect(options.method).toBe("POST");
    });
  });

  describe("retryStage", () => {
    it("posts to /runs/:id/actions/retry", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { ok: true, state: "x", retrying: true }));
      const result = await api.retryStage("r1");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/retry");
      expect(options.method).toBe("POST");
      expect(result).toEqual({ ok: true, state: "x", retrying: true });
    });
  });

  describe("getActiveProcesses", () => {
    it("requests /processes without a query string when no runId is given", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { processes: [] }));
      await api.getActiveProcesses();
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes");
    });

    it("requests /processes?runId=... when a runId is given", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { processes: [] }));
      await api.getActiveProcesses("r1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes?runId=r1");
    });
  });

  describe("getProcessOutput", () => {
    it("requests /processes/:id/output", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { processId: "p1", output: "log" }));
      const result = await api.getProcessOutput("p1");
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/processes/p1/output");
      expect(result).toEqual({ processId: "p1", output: "log" });
    });
  });

  describe("fetchPendingIssues", () => {
    it("requests /linear/pending", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { issues: [] }));
      await api.fetchPendingIssues();
      expect(fetchMock.mock.calls[0]![0]).toBe("/api/linear/pending");
    });
  });

  describe("ingestIssues", () => {
    it("posts issue ids to /linear/ingest", async () => {
      fetchMock.mockResolvedValue(
        makeResponse(true, 200, { ok: true, started: ["a"], skipped: [] }),
      );
      await api.ingestIssues(["a", "b"]);
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/linear/ingest");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({ issueIds: ["a", "b"] });
    });
  });

  describe("answerQuestions", () => {
    it("posts answers to /runs/:id/actions/answer-questions", async () => {
      fetchMock.mockResolvedValue(makeResponse(true, 200, { ok: true, run: { id: "r1" } }));
      const answers = [{ questionId: "q1", answer: "a1" }];
      await api.answerQuestions("r1", answers);
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/actions/answer-questions");
      expect(JSON.parse(options.body)).toEqual({ answers });
    });
  });

  describe("sendChatMessage", () => {
    it("posts a message to /runs/:id/chat and returns the reply", async () => {
      fetchMock.mockResolvedValue(
        makeResponse(true, 200, { reply: "hi there", durationMs: 42 }),
      );
      const result = await api.sendChatMessage("r1", "hello");
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/runs/r1/chat");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({ message: "hello" });
      expect(result).toEqual({ reply: "hi there", durationMs: 42 });
    });
  });
});
