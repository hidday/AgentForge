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

const untouchedOptionalQuestion = {
  id: "q2",
  question: "Any performance considerations?",
  requiredForExecution: false,
};

// Covers the two branches OpenQuestionsPanel.test.tsx leaves untested: the
// `answers[q.id] ?? ""` fallback for a question whose textarea was never
// touched, and the non-Error fallback message in the submit error handler.
describe("OpenQuestionsPanel gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes a question that was never touched from the submitted payload", async () => {
    mockApi.answerQuestions.mockResolvedValue({ ok: true, run: {} });

    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion, untouchedOptionalQuestion]}
        runId="run-1"
      />,
    );

    // Only fill the required question; leave q2's textarea untouched so
    // `answers["q2"]` is undefined when handleSubmit runs.
    const textarea = screen.getAllByRole("textbox")[0] as HTMLTextAreaElement;
    await userEvent.type(textarea, "Prod target");

    await userEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => {
      expect(mockApi.answerQuestions).toHaveBeenCalledWith("run-1", [
        { questionId: "q1", answer: "Prod target" },
      ]);
    });
  });

  it("shows a generic error message when the submission rejects with a non-Error value", async () => {
    mockApi.answerQuestions.mockRejectedValue("network unreachable");

    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion]}
        runId="run-1"
      />,
    );

    const textarea = screen.getAllByRole("textbox")[0] as HTMLTextAreaElement;
    await userEvent.type(textarea, "My answer");
    await userEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toBe("Failed to submit answers");
    });
  });
});
