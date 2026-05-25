import { useState } from "react";
import { cn } from "@/lib/utils.ts";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "default" | "destructive";
  loading?: boolean;
  /** Optional free-text note to capture from the operator and forward to the action. */
  notes?: {
    label?: string;
    placeholder?: string;
  };
  /**
   * Called when the operator confirms. The optional `note` argument is the trimmed
   * value from the notes textarea (or `undefined` when no notes prop / empty input).
   * The signature is widened from `() => void` so existing call sites pass-through cleanly.
   */
  onConfirm: (note?: string) => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  variant = "default",
  loading,
  notes,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [note, setNote] = useState("");

  if (!open) return null;

  const trimmed = note.trim();
  const noteForConfirm = notes && trimmed.length > 0 ? trimmed : undefined;

  function handleConfirmClick() {
    onConfirm(noteForConfirm);
    setNote("");
  }

  function handleCancelClick() {
    onCancel();
    setNote("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleCancelClick}
      />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-2xl">
        <h3 className="text-base font-semibold mb-1">{title}</h3>
        <p className="text-sm text-text-secondary mb-5">{description}</p>
        {notes && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {notes.label ?? "Notes for the next agent (optional)"}
            </label>
            <textarea
              className="w-full rounded-md border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent"
              rows={3}
              placeholder={notes.placeholder ?? "Optional: anything the next agent should know..."}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={loading}
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={handleCancelClick}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-md border border-border text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmClick}
            disabled={loading}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md font-medium transition-colors disabled:opacity-50",
              variant === "destructive"
                ? "bg-state-blocked text-white hover:bg-state-blocked/80"
                : "bg-accent text-white hover:bg-accent-hover",
            )}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Working...
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
