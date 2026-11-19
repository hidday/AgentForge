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
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getRuns requests the base runs path when no state filter is given", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ runs: [] }),
    );

    const result = await api.getRuns();

    expect(fetch).toHaveBeenCalledWith("/api/runs", expect.objectContaining({ headers: {} }));
    expect(result).toEqual({ runs: [] });
  });

  it("getRuns appends a state query param when provided", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ runs: [] }),
    );

    await api.getRuns("Implementing");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs?state=Implementing",
      expect.anything(),
    );
  });

  it("sends a JSON content-type header and serialized body for POST requests", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Done" }),
    );

    await api.approvePlan("run-1", "looks good");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/actions/approve-plan",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "looks good" }),
      }),
    );
  });

  it("omits the note field entirely when no note is passed", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Done" }),
    );

    await api.approvePlan("run-1");

    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(call[1].body)).toEqual({ note: undefined });
  });

  it("throws the server-provided error message on a non-ok response", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "Run not found" }, false, 404),
    );

    await expect(api.getRun("missing")).rejects.toThrow("Run not found");
  });

  it("falls back to an HTTP status message when the error body can't be parsed", async () => {
    const res = {
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error("not json")),
    } as unknown as Response;
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(res);

    await expect(api.getRun("run-1")).rejects.toThrow("HTTP 500");
  });

  it("rejectPlan defaults mode to 'iterate' when not specified", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, state: "Planning" }),
    );

    await api.rejectPlan("run-1", "needs work");

    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(call[1].body)).toEqual({ context: "needs work", mode: "iterate" });
  });

  it("getActiveProcesses appends a runId query param only when provided", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ processes: [] }),
    );

    await api.getActiveProcesses();
    expect(fetch).toHaveBeenLastCalledWith("/api/processes", expect.anything());

    await api.getActiveProcesses("run-1");
    expect(fetch).toHaveBeenLastCalledWith("/api/processes?runId=run-1", expect.anything());
  });

  it("ingestIssues POSTs the issue id list and returns the parsed summary", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ok: true, started: ["a"], skipped: [] }),
    );

    const result = await api.ingestIssues(["a"]);

    expect(fetch).toHaveBeenCalledWith(
      "/api/linear/ingest",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ issueIds: ["a"] }) }),
    );
    expect(result).toEqual({ ok: true, started: ["a"], skipped: [] });
  });

  it("sendChatMessage posts to the run-scoped chat endpoint", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ reply: "hi", durationMs: 12 }),
    );

    const result = await api.sendChatMessage("run-1", "hello");

    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/run-1/chat",
      expect.objectContaining({ body: JSON.stringify({ message: "hello" }) }),
    );
    expect(result).toEqual({ reply: "hi", durationMs: 12 });
  });

  it("propagates a network failure (fetch rejection) to the caller", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    await expect(api.getRuns()).rejects.toThrow("network down");
  });
});
