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

describe("OpenQuestionsPanel (gaps)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes a question the user never typed into from the submitted payload (the answers[id] ?? '' fallback)", async () => {
    mockApi.answerQuestions.mockResolvedValue({ ok: true, run: {} });
    const user = userEvent.setup();

    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion, optionalQuestion]}
        runId="run-1"
      />,
    );

    // Only fill the required question; never touch the optional textarea at all
    // (so `answers["q2"]` is `undefined`, not an empty string).
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    await user.type(textareas[0], "Prod target");

    const submitBtn = screen.getByRole("button", { name: /submit answers/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockApi.answerQuestions).toHaveBeenCalledWith("run-1", [
        { questionId: "q1", answer: "Prod target" },
      ]);
    });
  });

  it("falls back to a generic error message when a non-Error is thrown from answerQuestions", async () => {
    mockApi.answerQuestions.mockRejectedValue("not an Error instance");
    const user = userEvent.setup();

    render(<OpenQuestionsPanel questions={[requiredQuestion]} runId="run-1" />);

    const textarea = screen.getAllByRole("textbox")[0] as HTMLTextAreaElement;
    await user.type(textarea, "My answer");

    const submitBtn = screen.getByRole("button", { name: /submit answers/i });
    await user.click(submitBtn);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Failed to submit answers");
    });
  });
});
