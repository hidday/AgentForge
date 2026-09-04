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

describe("OpenQuestionsPanel — additional coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits questions with no answer at all (undefined, not just empty) from the submitted payload", async () => {
    mockApi.answerQuestions.mockResolvedValue({ ok: true, run: {} });

    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion, optionalQuestion]}
        runId="run-1"
      />,
    );

    // Only fill the required question; the optional one's answer stays
    // undefined in state (never typed into), exercising the `answers[q.id] ?? ""`
    // fallback in the payload-building filter.
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
    mockApi.answerQuestions.mockRejectedValue("network down");

    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion]}
        runId="run-1"
      />,
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
