import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./client.ts";

type FetchResponseInit = {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
};

function fakeResponse({ ok, status, json }: FetchResponseInit) {
  return {
    ok,
    status: status ?? (ok ? 200 : 500),
    json: json ?? (() => Promise.resolve({})),
  } as Response;
}

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  describe("request() construction and response handling", () => {
    it("resolves with the parsed JSON body on an ok response", async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ ok: true, json: () => Promise.resolve({ runs: [{ id: "r1" }] }) }),
      );
      const result = await api.getRuns();
      expect(result).toEqual({ runs: [{ id: "r1" }] });
    });

    it("omits the Content-Type header when there is no body", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ runs: [] }) }));
      await api.getRuns();
      expect(fetchMock).toHaveBeenCalledWith("/api/runs", { headers: {} });
    });

    it("adds a JSON Content-Type header when a body is present", async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true, state: "x" }) }),
      );
      await api.approvePlan("run-1", "note");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "note" }),
      });
    });

    it("throws the server-provided error message when the response is not ok", async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ ok: false, status: 400, json: () => Promise.resolve({ error: "Bad input" }) }),
      );
      await expect(api.getRuns()).rejects.toThrow("Bad input");
    });

    it("falls back to 'HTTP <status>' when the error body has no error field", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: false, status: 500, json: () => Promise.resolve({}) }));
      await expect(api.getRuns()).rejects.toThrow("HTTP 500");
    });

    it("falls back to 'HTTP <status>' when the error body cannot be parsed as JSON", async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ ok: false, status: 503, json: () => Promise.reject(new Error("parse failure")) }),
      );
      await expect(api.getRuns()).rejects.toThrow("HTTP 503");
    });
  });

  describe("getRuns", () => {
    it("requests /api/runs with no query string when state is omitted", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ runs: [] }) }));
      await api.getRuns();
      expect(fetchMock).toHaveBeenCalledWith("/api/runs", { headers: {} });
    });

    it("appends ?state=<state> when a state filter is given", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ runs: [] }) }));
      await api.getRuns("running");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs?state=running", { headers: {} });
    });
  });

  describe("getRun", () => {
    it("requests /api/runs/<id>", async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ ok: true, json: () => Promise.resolve({ run: {}, artifacts: [], events: [] }) }),
      );
      await api.getRun("run-42");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-42", { headers: {} });
    });
  });

  describe("getRunSkills", () => {
    it("requests /api/runs/<id>/skills", async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({
          ok: true,
          json: () => Promise.resolve({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
        }),
      );
      await api.getRunSkills("run-7");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-7/skills", { headers: {} });
    });
  });

  describe("getArtifacts", () => {
    it("requests /api/runs/<id>/artifacts", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ artifacts: [] }) }));
      await api.getArtifacts("run-7");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-7/artifacts", { headers: {} });
    });
  });

  describe("getEvents", () => {
    it("requests /api/runs/<id>/events", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ events: [] }) }));
      await api.getEvents("run-7");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-7/events", { headers: {} });
    });
  });

  describe("approvePlan", () => {
    it("POSTs with the given note", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true, state: "x" }) }));
      await api.approvePlan("run-1", "looks good");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "looks good" }),
      });
    });

    it("omits note from the body when not provided", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true, state: "x" }) }));
      await api.approvePlan("run-1");
      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({});
    });
  });

  describe("rejectPlan", () => {
    it("defaults mode to 'iterate' and omits context when not given", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true, state: "x" }) }));
      await api.rejectPlan("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: undefined, mode: "iterate" }),
      });
    });

    it("sends the given context and 'fresh' mode", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true, state: "x" }) }));
      await api.rejectPlan("run-1", "needs rework", "fresh");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/reject-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ context: "needs rework", mode: "fresh" }),
      });
    });
  });

  describe("reReviewPlan", () => {
    it("POSTs with the given note", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) }));
      await api.reReviewPlan("run-1", "re-check this");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/re-review-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "re-check this" }),
      });
    });

    it("omits note from the body when not provided", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) }));
      await api.reReviewPlan("run-1");
      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({});
    });
  });

  describe("revisePlan", () => {
    it("POSTs with the given note", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) }));
      await api.revisePlan("run-1", "revise this");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/revise-plan", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ note: "revise this" }),
      });
    });

    it("omits note from the body when not provided", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true, runId: "run-1" }) }));
      await api.revisePlan("run-1");
      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({});
    });
  });

  describe("approveReview", () => {
    it("POSTs with no body and no Content-Type header", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true, state: "x" }) }));
      await api.approveReview("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/approve-review", {
        headers: {},
        method: "POST",
      });
    });
  });

  describe("pauseRun", () => {
    it("POSTs to the pause action", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true }) }));
      await api.pauseRun("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/pause", { headers: {}, method: "POST" });
    });
  });

  describe("resumeRun", () => {
    it("POSTs to the resume action", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true }) }));
      await api.resumeRun("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/resume", { headers: {}, method: "POST" });
    });
  });

  describe("retryStage", () => {
    it("POSTs to the retry action", async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true, state: "x", retrying: true }) }),
      );
      await api.retryStage("run-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/retry", { headers: {}, method: "POST" });
    });
  });

  describe("getActiveProcesses", () => {
    it("requests /api/processes with no query string when runId is omitted", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ processes: [] }) }));
      await api.getActiveProcesses();
      expect(fetchMock).toHaveBeenCalledWith("/api/processes", { headers: {} });
    });

    it("appends ?runId=<id> when a runId is given", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ processes: [] }) }));
      await api.getActiveProcesses("run-9");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes?runId=run-9", { headers: {} });
    });
  });

  describe("getProcessOutput", () => {
    it("requests /api/processes/<id>/output", async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ ok: true, json: () => Promise.resolve({ processId: "p1", output: "log" }) }),
      );
      await api.getProcessOutput("p1");
      expect(fetchMock).toHaveBeenCalledWith("/api/processes/p1/output", { headers: {} });
    });
  });

  describe("fetchPendingIssues", () => {
    it("requests /api/linear/pending", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ issues: [] }) }));
      await api.fetchPendingIssues();
      expect(fetchMock).toHaveBeenCalledWith("/api/linear/pending", { headers: {} });
    });
  });

  describe("ingestIssues", () => {
    it("POSTs the given issue ids", async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true, started: ["a"], skipped: [] }) }),
      );
      await api.ingestIssues(["a", "b"]);
      expect(fetchMock).toHaveBeenCalledWith("/api/linear/ingest", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ issueIds: ["a", "b"] }),
      });
    });
  });

  describe("answerQuestions", () => {
    it("POSTs the given answers", async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: true, json: () => Promise.resolve({ ok: true, run: {} }) }));
      const answers = [{ questionId: "q1", answer: "yes" }];
      await api.answerQuestions("run-1", answers);
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/actions/answer-questions", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ answers }),
      });
    });
  });

  describe("sendChatMessage", () => {
    it("POSTs the given message", async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ ok: true, json: () => Promise.resolve({ reply: "hi", durationMs: 1 }) }),
      );
      await api.sendChatMessage("run-1", "hello there");
      expect(fetchMock).toHaveBeenCalledWith("/api/runs/run-1/chat", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({ message: "hello there" }),
      });
    });
  });
});
