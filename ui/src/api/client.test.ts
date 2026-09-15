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

  describe("request()", () => {
    it("resolves with the parsed JSON body on a successful response", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ runs: [] }),
      );

      const result = await api.getRuns();

      expect(result).toEqual({ runs: [] });
    });

    it("throws an Error with the JSON error message on a non-ok response", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ error: "Run not found" }, false, 404),
      );

      await expect(api.getRun("missing")).rejects.toThrow("Run not found");
    });

    it("falls back to 'HTTP <status>' when the error body isn't valid JSON", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("not json")),
      } as unknown as Response);

      await expect(api.getRun("bad")).rejects.toThrow("HTTP 500");
    });

    it("adds a Content-Type: application/json header when a body is present", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

      await api.approvePlan("run-1", "looks good");

      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect((options.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );
    });

    it("does not add a Content-Type header for a bodyless GET", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));

      await api.getRuns();

      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect((options.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    });
  });

  describe("api.getRuns", () => {
    it("requests the runs list with no query string when state is omitted", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));

      await api.getRuns();

      expect(fetch).toHaveBeenCalledWith("/api/runs", expect.any(Object));
    });

    it("requests the runs list filtered by state when provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));

      await api.getRuns("Implementing");

      expect(fetch).toHaveBeenCalledWith("/api/runs?state=Implementing", expect.any(Object));
    });
  });

  describe("api.getRun", () => {
    it("requests the run detail endpoint for the given id", async () => {
      const payload = { run: { id: "r1" }, artifacts: [], events: [] };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

      const result = await api.getRun("r1");

      expect(fetch).toHaveBeenCalledWith("/api/runs/r1", expect.any(Object));
      expect(result).toEqual(payload);
    });
  });

  describe("api.approvePlan", () => {
    it("POSTs to the approve-plan endpoint with an optional note", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.approvePlan("run-1", "note text");

      const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/approve-plan");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body as string)).toEqual({ note: "note text" });
    });

    it("sends note: undefined when no note is given", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.approvePlan("run-1");

      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(JSON.parse(options.body as string)).toEqual({});
    });
  });

  describe("api.rejectPlan", () => {
    it("POSTs with context and mode when both are provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.rejectPlan("run-1", "needs more detail", "fresh");

      const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/reject-plan");
      expect(JSON.parse(options.body as string)).toEqual({
        context: "needs more detail",
        mode: "fresh",
      });
    });

    it("defaults mode to 'iterate' and omits context when neither is provided", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));

      await api.rejectPlan("run-1");

      const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(JSON.parse(options.body as string)).toEqual({ mode: "iterate" });
    });
  });

  describe("api.answerQuestions", () => {
    it("POSTs the answers array to the answer-questions endpoint", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, run: {} }),
      );

      const answers = [{ questionId: "q1", answer: "42" }];
      await api.answerQuestions("run-1", answers);

      const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/actions/answer-questions");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body as string)).toEqual({ answers });
    });
  });

  describe("api.sendChatMessage", () => {
    it("POSTs the message to the run's chat endpoint", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ reply: "hi", durationMs: 5 }),
      );

      const result = await api.sendChatMessage("run-1", "hello there");

      const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe("/api/runs/run-1/chat");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body as string)).toEqual({ message: "hello there" });
      expect(result).toEqual({ reply: "hi", durationMs: 5 });
    });
  });

  describe("api.ingestIssues", () => {
    it("POSTs the issue ids to the ingest endpoint", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ ok: true, started: ["i1"], skipped: [] }),
      );

      await api.ingestIssues(["i1", "i2"]);

      const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe("/api/linear/ingest");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body as string)).toEqual({ issueIds: ["i1", "i2"] });
    });
  });
});
