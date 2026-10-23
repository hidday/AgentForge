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
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("getRuns issues a GET to /api/runs with no query string when no state filter is given", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
    const result = await api.getRuns();
    expect(global.fetch).toHaveBeenCalledWith("/api/runs", expect.objectContaining({ headers: {} }));
    expect(result).toEqual({ runs: [] });
  });

  it("getRuns appends the state filter as a query parameter when provided", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ runs: [] }));
    await api.getRuns("Planning");
    expect(global.fetch).toHaveBeenCalledWith("/api/runs?state=Planning", expect.anything());
  });

  it("getRun requests the run detail endpoint and returns parsed JSON", async () => {
    const payload = { run: { id: "r1" }, artifacts: [], events: [] };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));
    const result = await api.getRun("r1");
    expect(global.fetch).toHaveBeenCalledWith("/api/runs/r1", expect.anything());
    expect(result).toEqual(payload);
  });

  it("getRunSkills requests the skills sub-resource", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ injectedSkills: [], distillationDecision: null, distilledSkill: null }),
    );
    await api.getRunSkills("r1");
    expect(global.fetch).toHaveBeenCalledWith("/api/runs/r1/skills", expect.anything());
  });

  it("sets a JSON Content-Type header and serializes the body on POST requests with a body", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
    await api.approvePlan("r1", "looks good");

    const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/runs/r1/actions/approve-plan");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(options.body)).toEqual({ note: "looks good" });
  });

  it("omits the note field (as undefined) when approvePlan is called without one", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
    await api.approvePlan("r1");
    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({});
  });

  it("rejectPlan defaults mode to 'iterate' when not provided", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
    await api.rejectPlan("r1");
    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ mode: "iterate" });
  });

  it("rejectPlan passes through an explicit context and mode", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true, state: "x" }));
    await api.rejectPlan("r1", "needs rework", "fresh");
    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ context: "needs rework", mode: "fresh" });
  });

  it("pauseRun issues a bodiless POST (no Content-Type header)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await api.pauseRun("r1");
    const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/runs/r1/actions/pause");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({});
  });

  it("getActiveProcesses omits the runId query param when not given", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
    await api.getActiveProcesses();
    expect(global.fetch).toHaveBeenCalledWith("/api/processes", expect.anything());
  });

  it("getActiveProcesses includes the runId query param when given", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ processes: [] }));
    await api.getActiveProcesses("r1");
    expect(global.fetch).toHaveBeenCalledWith("/api/processes?runId=r1", expect.anything());
  });

  it("ingestIssues sends the issueIds array as the JSON body", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, started: ["a"], skipped: [] }),
    );
    await api.ingestIssues(["a", "b"]);
    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ issueIds: ["a", "b"] });
  });

  it("sendChatMessage posts the message and returns the reply payload", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ reply: "hi", durationMs: 12 }),
    );
    const result = await api.sendChatMessage("r1", "hello");
    const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/runs/r1/chat");
    expect(JSON.parse(options.body)).toEqual({ message: "hello" });
    expect(result).toEqual({ reply: "hi", durationMs: 12 });
  });

  it("throws an Error using the server-provided error message when the response is not ok", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "Run not found" }, false, 404),
    );
    await expect(api.getRun("missing")).rejects.toThrow("Run not found");
  });

  it("falls back to an 'HTTP <status>' message when the error body has no error field", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 500));
    await expect(api.getRun("r1")).rejects.toThrow("HTTP 500");
  });

  it("falls back to an 'HTTP <status>' message when the error body is not valid JSON", async () => {
    const res = {
      ok: false,
      status: 503,
      json: vi.fn().mockRejectedValue(new Error("not json")),
    } as unknown as Response;
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(res);
    await expect(api.getRun("r1")).rejects.toThrow("HTTP 503");
  });

  it("propagates a network-level rejection (fetch itself throwing)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network down"));
    await expect(api.getRuns()).rejects.toThrow("Network down");
  });
});
