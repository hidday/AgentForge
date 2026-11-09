import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpenQuestionsPanel } from "./OpenQuestionsPanel.tsx";

vi.mock("@/api/client.ts", () => ({
  api: {
    answerQuestions: vi.fn(),
  },
}));

import { api } from "@/api/client.ts";

const mockApi = api as unknown as { answerQuestions: ReturnType<typeof vi.fn> };

const requiredQuestion = {
  id: "q1",
  question: "What is your deployment target?",
  requiredForExecution: true,
};

const optionalQuestion = {
  id: "q2",
  question: "Any performance considerations?",
  requiredForExecution: false,
};

describe("OpenQuestionsPanel branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes questions that were never answered from the submit payload", async () => {
    mockApi.answerQuestions.mockResolvedValue({ ok: true, run: {} });

    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion, optionalQuestion]}
        runId="run-1"
      />,
    );

    // Only fill the required question; leave the optional one completely
    // untouched so `answers[optionalQuestion.id]` is undefined, exercising
    // the `?? ""` fallback inside the submit filter.
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    await userEvent.type(textareas[0], "Prod target");

    const submitBtn = screen.getByRole("button", { name: /submit answers/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockApi.answerQuestions).toHaveBeenCalledWith("run-1", [
        { questionId: "q1", answer: "Prod target" },
      ]);
    });
  });

  it("shows the 'Submitting…' label on the button while the request is pending", async () => {
    let resolveRequest!: (v: { ok: boolean; run: unknown }) => void;
    mockApi.answerQuestions.mockReturnValue(
      new Promise((res) => {
        resolveRequest = res;
      }),
    );

    render(
      <OpenQuestionsPanel questions={[requiredQuestion]} runId="run-1" />,
    );

    const textarea = screen.getAllByRole("textbox")[0] as HTMLTextAreaElement;
    await userEvent.type(textarea, "My answer");
    await userEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    expect(screen.getByRole("button", { name: /submitting/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^submit answers$/i })).toBeNull();

    resolveRequest({ ok: true, run: {} });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^submit answers$/i })).toBeDefined();
    });
  });

  it("shows a generic error message when the rejection is not an Error instance", async () => {
    mockApi.answerQuestions.mockRejectedValue("plain string failure");

    render(
      <OpenQuestionsPanel questions={[requiredQuestion]} runId="run-1" />,
    );

    const textarea = screen.getAllByRole("textbox")[0] as HTMLTextAreaElement;
    await userEvent.type(textarea, "My answer");
    await userEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Failed to submit answers",
      );
    });
  });
});
