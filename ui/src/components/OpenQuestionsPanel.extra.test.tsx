import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpenQuestionsPanel } from "./OpenQuestionsPanel.tsx";

// Additive coverage for OpenQuestionsPanel.tsx. See OpenQuestionsPanel.test.tsx
// for the main suite; this closes the two remaining branch gaps (the
// unanswered-question filter branch in handleSubmit's payload, and the
// non-Error rejection fallback message) without touching the existing file.
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

    // Only fill the required question; leave the optional one untouched so
    // its `answers[q.id] ?? ""` evaluates via the nullish fallback.
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

  it("falls back to a generic error message when the rejection is not an Error instance", async () => {
    mockApi.answerQuestions.mockRejectedValue("network blip");

    render(
      <OpenQuestionsPanel questions={[requiredQuestion]} runId="run-1" />,
    );

    const textarea = screen.getAllByRole("textbox")[0] as HTMLTextAreaElement;
    await userEvent.type(textarea, "My answer");

    const submitBtn = screen.getByRole("button", { name: /submit answers/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Failed to submit answers");
    });
  });
});
