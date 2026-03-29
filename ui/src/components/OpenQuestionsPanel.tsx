import { useState, useId } from "react";
import { api } from "@/api/client.ts";

export interface OpenQuestion {
  id: string;
  question: string;
  requiredForExecution: boolean;
}

interface OpenQuestionsPanelProps {
  questions: OpenQuestion[];
  runId: string;
  readOnly?: boolean;
  onSubmitted?: () => void;
}

export function OpenQuestionsPanel({
  questions,
  runId,
  readOnly = false,
  onSubmitted,
}: OpenQuestionsPanelProps) {
  const panelId = useId();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  const requiredQuestions = questions.filter((q) => q.requiredForExecution);
  const allRequiredFilled = requiredQuestions.every(
    (q) => (answers[q.id] ?? "").trim().length > 0,
  );

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      const payload = questions
        .filter((q) => (answers[q.id] ?? "").trim().length > 0)
        .map((q) => ({ questionId: q.id, answer: answers[q.id].trim() }));

      await api.answerQuestions(runId, payload);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit answers");
    } finally {
      setLoading(false);
    }
  }

  if (questions.length === 0) return null;

  return (
    <section
      id={`open-questions-panel-${panelId}`}
      className="rounded-lg border border-border bg-surface p-4 space-y-4"
      aria-label="Open Questions"
    >
      <h2 className="text-sm font-semibold text-text-primary">Open Questions</h2>

      <div className="space-y-4">
        {questions.map((q) => (
          <div key={q.id} className="space-y-1.5">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-0.5">
                <span className="block text-xs font-mono text-text-muted">{q.id}</span>
                <span className="text-sm text-text-secondary">{q.question}</span>
              </div>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
                  q.requiredForExecution
                    ? "bg-state-blocked/10 text-state-blocked"
                    : "bg-surface-hover text-text-muted"
                }`}
              >
                {q.requiredForExecution ? "Required" : "Optional"}
              </span>
            </div>

            {readOnly ? (
              <p className="text-sm text-text-muted italic">
                {answers[q.id] ?? "(no answer provided)"}
              </p>
            ) : (
              <textarea
                className="w-full rounded border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                rows={3}
                placeholder={`Answer for question ${q.id}…`}
                value={answers[q.id] ?? ""}
                onChange={(e) => handleChange(q.id, e.target.value)}
                disabled={loading}
              />
            )}
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!allRequiredFilled || loading}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Submitting…" : "Submit Answers"}
          </button>

          {error && (
            <p className="text-sm text-state-blocked" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
