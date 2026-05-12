import type { RunEventRecord } from "@/api/client.ts";
import { relativeTime, formatTimestamp } from "@/lib/utils.ts";
import { cn } from "@/lib/utils.ts";
import {
  Zap,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  User,
  Bot,
  ArrowRight,
} from "lucide-react";

const EVENT_ICONS: Record<string, typeof Zap> = {
  RUN_REQUESTED: Zap,
  PLAN_CREATED: FileText,
  PLAN_REVIEW_APPROVED: CheckCircle2,
  PLAN_REVIEW_CHANGES_REQUESTED: XCircle,
  PLAN_REVISED: FileText,
  PLAN_APPROVED: CheckCircle2,
  PLAN_REJECTED: XCircle,
  EXECUTION_STARTED: Zap,
  EXECUTION_FINISHED: CheckCircle2,
  REVIEW_APPROVED: CheckCircle2,
  REVIEW_CHANGES_REQUESTED: XCircle,
  REMEDIATION_FINISHED: CheckCircle2,
  HUMAN_APPROVED: CheckCircle2,
  BLOCKED: AlertTriangle,
  NEEDS_HUMAN_CLARIFICATION: AlertTriangle,
  RESET_TO_TODO: Zap,
};

const SOURCE_ICONS: Record<string, typeof User> = {
  human: User,
  "user-command": User,
};

function formatEventType(type: string): string {
  return type
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface EventTimelineProps {
  events: RunEventRecord[];
}

export function EventTimeline({ events }: EventTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted text-sm">
        No events yet
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
        Events
      </h3>
      <div className="space-y-2">
        {[...events].reverse().map((event) => {
          const Icon = EVENT_ICONS[event.eventType] ?? Zap;
          const SourceIcon = SOURCE_ICONS[event.source] ?? Bot;
          const payload = event.payloadJson as {
            from?: string;
            to?: string;
            feedback?: string;
          } | null;

          return (
            <div
              key={event.id}
              className="group rounded-md border border-border-subtle bg-surface p-2.5 hover:bg-surface-hover transition-colors"
            >
              <div className="flex items-start gap-2">
                <Icon
                  size={14}
                  className={cn(
                    "mt-0.5 flex-shrink-0",
                    event.eventType.includes("APPROVED") ||
                      event.eventType === "EXECUTION_FINISHED" ||
                      event.eventType === "REMEDIATION_FINISHED"
                      ? "text-state-done"
                      : event.eventType.includes("REJECTED") ||
                          event.eventType.includes("CHANGES_REQUESTED") ||
                          event.eventType === "BLOCKED"
                        ? "text-state-blocked"
                        : "text-accent",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-text-primary">
                    {formatEventType(event.eventType)}
                  </div>
                  {payload?.from && payload?.to && (
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-text-muted">
                      <span className="font-mono">{payload.from}</span>
                      <ArrowRight size={8} />
                      <span className="font-mono">{payload.to}</span>
                    </div>
                  )}
                  {event.eventType === "PLAN_REJECTED" && payload?.feedback && (
                    <p className="mt-1 pl-2 text-[10px] text-text-secondary border-l border-border-subtle italic">
                      {payload.feedback}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex items-center gap-1 text-[10px] text-text-muted">
                      <SourceIcon size={10} />
                      <span>{event.source}</span>
                    </div>
                    <span
                      className="text-[10px] text-text-muted"
                      title={formatTimestamp(event.createdAt)}
                    >
                      {relativeTime(event.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
