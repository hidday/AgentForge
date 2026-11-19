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

describe("OpenQuestionsPanel - additional branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits unanswered optional questions from the submitted payload", async () => {
    mockApi.answerQuestions.mockResolvedValue({ ok: true, run: {} });
    const user = userEvent.setup();

    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion, optionalQuestion]}
        runId="run-1"
      />,
    );

    // Only answer the required question; leave the optional one blank.
    await user.type(
      screen.getByPlaceholderText(/Answer for question q1/i),
      "Production",
    );
    await user.click(screen.getByRole("button", { name: /Submit Answers/i }));

    await waitFor(() => expect(mockApi.answerQuestions).toHaveBeenCalledOnce());
    expect(mockApi.answerQuestions).toHaveBeenCalledWith("run-1", [
      { questionId: "q1", answer: "Production" },
    ]);
  });

  it("shows a generic error message when the rejection is not an Error instance", async () => {
    mockApi.answerQuestions.mockRejectedValue("boom");
    const user = userEvent.setup();

    render(<OpenQuestionsPanel questions={[requiredQuestion]} runId="run-1" />);

    await user.type(
      screen.getByPlaceholderText(/Answer for question q1/i),
      "Staging",
    );
    await user.click(screen.getByRole("button", { name: /Submit Answers/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Failed to submit answers"),
    );
  });
});
