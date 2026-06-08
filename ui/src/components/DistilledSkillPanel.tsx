import { Sparkles } from "lucide-react";
import type { DistillationDecision, SkillDocument } from "@/api/client.ts";
import { Markdown } from "@/components/Markdown.tsx";

interface DistilledSkillPanelProps {
  distilledSkill: SkillDocument | null;
  distillationDecision: DistillationDecision | null;
  loading?: boolean;
  error?: string | null;
}

export function DistilledSkillPanel({
  distilledSkill,
  distillationDecision,
  loading = false,
  error = null,
}: DistilledSkillPanelProps) {
  if (loading) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          Loading distilled skill...
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-lg border border-state-blocked/30 bg-state-blocked-bg p-4">
        <p className="text-sm text-state-blocked">{error}</p>
      </section>
    );
  }

  if (!distillationDecision?.shouldPersist) {
    return null;
  }

  return (
    <section className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
        <Sparkles size={16} className="text-accent flex-shrink-0" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">Distilled Skill</h2>
          {distillationDecision.taskCategory && (
            <p className="text-xs text-text-muted truncate">
              {distillationDecision.taskCategory}
            </p>
          )}
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {distillationDecision.reason && (
          <p className="text-xs text-text-muted italic border-l-2 border-border-subtle pl-2">
            {distillationDecision.reason}
          </p>
        )}

        {distilledSkill ? (
          <div className="rounded-md border border-border-subtle bg-surface-subtle/40 p-3 text-xs leading-relaxed">
            <Markdown>{distilledSkill.skillMarkdown}</Markdown>
          </div>
        ) : (
          <p className="text-xs text-text-muted">
            A skill was persisted for this run, but its content could not be loaded.
          </p>
        )}

        {distillationDecision.displacedSkillId && (
          <p className="text-[10px] text-text-muted font-mono">
            Displaced skill: {distillationDecision.displacedSkillId.slice(0, 8)}
          </p>
        )}
      </div>
    </section>
  );
}
