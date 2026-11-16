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

describe("OpenQuestionsPanel — payload filtering for unanswered optional questions (line 53)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits an optional question left blank from the submitted payload", async () => {
    mockApi.answerQuestions.mockResolvedValue({ ok: true, run: {} });

    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion, optionalQuestion]}
        runId="run-1"
      />,
    );

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    // Fill only the required question; leave the optional one blank so
    // answers[q2.id] is undefined when the payload filter runs.
    await userEvent.type(textareas[0], "Prod target");

    const submitBtn = screen.getByRole("button", { name: /submit answers/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockApi.answerQuestions).toHaveBeenCalledWith("run-1", [
        { questionId: "q1", answer: "Prod target" },
      ]);
    });
  });
});

describe("OpenQuestionsPanel — non-Error rejection fallback message (line 64)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the generic fallback message when the API rejects with a non-Error value", async () => {
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
      expect(alert.textContent).toBe("Failed to submit answers");
    });
  });
});
