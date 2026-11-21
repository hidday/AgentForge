// Supplementary OpenQuestionsPanel coverage: unanswered optional questions are
// omitted from the payload, and non-Error failures get a generic message.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/api/client.ts", () => ({ api: { answerQuestions: vi.fn() } }));

import { api } from "@/api/client.ts";
import { OpenQuestionsPanel } from "./OpenQuestionsPanel.tsx";

const answer = api.answerQuestions as unknown as ReturnType<typeof vi.fn>;

const questions = [
  { id: "q1", question: "Which DB?", requiredForExecution: true },
  { id: "q2", question: "Any style prefs?", requiredForExecution: false },
  { id: "q3", question: "Deadline?", requiredForExecution: false },
];

beforeEach(() => {
  answer.mockReset();
});

describe("OpenQuestionsPanel submit payload", () => {
  it("only sends trimmed non-empty answers, skipping untouched and blank optional ones", async () => {
    answer.mockResolvedValue({ ok: true });
    const onSubmitted = vi.fn();
    render(<OpenQuestionsPanel questions={questions} runId="r7" onSubmitted={onSubmitted} />);
    fireEvent.change(screen.getByPlaceholderText("Answer for question q1…"), { target: { value: " Postgres " } });
    fireEvent.change(screen.getByPlaceholderText("Answer for question q3…"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Answers" }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(answer).toHaveBeenCalledWith("r7", [{ questionId: "q1", answer: "Postgres" }]);
    expect(screen.getByRole("status").textContent).toBe("Answers submitted. Re-planning…");
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it("shows a generic error for non-Error rejections and does not call onSubmitted", async () => {
    answer.mockRejectedValue("server exploded");
    const onSubmitted = vi.fn();
    render(<OpenQuestionsPanel questions={questions} runId="r7" onSubmitted={onSubmitted} />);
    fireEvent.change(screen.getByPlaceholderText("Answer for question q1…"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Answers" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Failed to submit answers");
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});
