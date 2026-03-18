import { cn } from "@/lib/utils.ts";
import { getStateBadgeClass, getStateDotClass, getStateCategory, formatStateName } from "@/lib/stateColors.ts";

interface StateBadgeProps {
  state: string;
  className?: string;
}

export function StateBadge({ state, className }: StateBadgeProps) {
  const category = getStateCategory(state);
  const isActive = category === "active";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        getStateBadgeClass(state),
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          getStateDotClass(state),
          isActive && "animate-pulse-dot",
        )}
      />
      {formatStateName(state)}
    </span>
  );
}
