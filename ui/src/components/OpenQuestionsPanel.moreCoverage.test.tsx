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

describe("OpenQuestionsPanel – additional branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes unanswered optional questions from the submitted payload", async () => {
    mockApi.answerQuestions.mockResolvedValue({ ok: true, run: {} });

    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion, optionalQuestion]}
        runId="run-1"
      />,
    );

    // Only fill in the required question; leave the optional one blank.
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    await userEvent.type(textareas[0], "Prod target");

    await userEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => {
      expect(mockApi.answerQuestions).toHaveBeenCalledWith("run-1", [
        { questionId: "q1", answer: "Prod target" },
      ]);
    });
  });

  it("shows a generic error message when submission rejects with a non-Error value", async () => {
    mockApi.answerQuestions.mockRejectedValue("network blip");

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
