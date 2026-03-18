export type StateCategory = "active" | "waiting" | "blocked" | "done" | "idle";

const STATE_CATEGORIES: Record<string, StateCategory> = {
  Todo: "idle",
  Planning: "active",
  PlanReview: "active",
  PlanRevision: "active",
  AwaitingPlanApproval: "waiting",
  Implementing: "active",
  AIReview: "active",
  AddressingReview: "active",
  ReadyForHumanReview: "waiting",
  Done: "done",
  AIBlocked: "blocked",
  HumanClarificationNeeded: "waiting",
};

export function getStateCategory(state: string): StateCategory {
  return STATE_CATEGORIES[state] ?? "idle";
}

const CATEGORY_CLASSES: Record<StateCategory, { badge: string; dot: string }> = {
  active: {
    badge: "bg-state-active-bg text-state-active border-state-active/30",
    dot: "bg-state-active",
  },
  waiting: {
    badge: "bg-state-waiting-bg text-state-waiting border-state-waiting/30",
    dot: "bg-state-waiting",
  },
  blocked: {
    badge: "bg-state-blocked-bg text-state-blocked border-state-blocked/30",
    dot: "bg-state-blocked",
  },
  done: {
    badge: "bg-state-done-bg text-state-done border-state-done/30",
    dot: "bg-state-done",
  },
  idle: {
    badge: "bg-state-idle-bg text-state-idle border-state-idle/30",
    dot: "bg-state-idle",
  },
};

export function getStateBadgeClass(state: string): string {
  const category = getStateCategory(state);
  return CATEGORY_CLASSES[category].badge;
}

export function getStateDotClass(state: string): string {
  const category = getStateCategory(state);
  return CATEGORY_CLASSES[category].dot;
}

export function formatStateName(state: string): string {
  return state.replace(/([A-Z])/g, " $1").trim();
}
