import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpenQuestionsPanel } from "./OpenQuestionsPanel.tsx";

// Mock the api module
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

describe("OpenQuestionsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders questions with Required/Optional badges", () => {
    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion, optionalQuestion]}
        runId="run-1"
      />,
    );

    expect(screen.getByText(requiredQuestion.question)).toBeDefined();
    expect(screen.getByText(optionalQuestion.question)).toBeDefined();
    expect(screen.getByText("Required")).toBeDefined();
    expect(screen.getByText("Optional")).toBeDefined();
  });

  it("submit button is disabled initially when required fields are empty", () => {
    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion]}
        runId="run-1"
      />,
    );

    const submitBtn = screen.getByRole("button", { name: /submit answers/i });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("submit button becomes enabled when all required fields are filled", async () => {
    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion]}
        runId="run-1"
      />,
    );

    const textarea = screen.getAllByRole("textbox")[0] as HTMLTextAreaElement;
    await userEvent.type(textarea, "My answer");

    const submitBtn = screen.getByRole("button", { name: /submit answers/i });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("submit button stays disabled if only optional fields are filled", async () => {
    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion, optionalQuestion]}
        runId="run-1"
      />,
    );

    // Fill only the optional question (index 1)
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    await userEvent.type(textareas[1], "Optional answer");

    const submitBtn = screen.getByRole("button", { name: /submit answers/i });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("calls api.answerQuestions with correct payload on submit", async () => {
    mockApi.answerQuestions.mockResolvedValue({ ok: true, run: {} });

    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion, optionalQuestion]}
        runId="run-1"
        onSubmitted={vi.fn()}
      />,
    );

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    await userEvent.type(textareas[0], "Prod target");
    await userEvent.type(textareas[1], "Low latency");

    const submitBtn = screen.getByRole("button", { name: /submit answers/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockApi.answerQuestions).toHaveBeenCalledWith("run-1", [
        { questionId: "q1", answer: "Prod target" },
        { questionId: "q2", answer: "Low latency" },
      ]);
    });
  });

  it("calls onSubmitted callback on successful submission", async () => {
    mockApi.answerQuestions.mockResolvedValue({ ok: true, run: {} });
    const onSubmitted = vi.fn();

    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion]}
        runId="run-1"
        onSubmitted={onSubmitted}
      />,
    );

    const textarea = screen.getAllByRole("textbox")[0] as HTMLTextAreaElement;
    await userEvent.type(textarea, "My answer");

    const submitBtn = screen.getByRole("button", { name: /submit answers/i });
    await userEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledOnce();
    });
  });

  it("shows error message on failed submission", async () => {
    mockApi.answerQuestions.mockRejectedValue(new Error("Unrecognised questionId"));

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
      expect(alert.textContent).toContain("Unrecognised questionId");
    });
  });

  it("renders in readOnly mode without submit button", () => {
    render(
      <OpenQuestionsPanel
        questions={[requiredQuestion]}
        runId="run-1"
        readOnly={true}
      />,
    );

    expect(screen.queryByRole("button", { name: /submit answers/i })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("returns null when questions array is empty", () => {
    const { container } = render(
      <OpenQuestionsPanel questions={[]} runId="run-1" />,
    );
    expect(container.firstChild).toBeNull();
  });
});
