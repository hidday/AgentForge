import { RunState } from "../domain/runState.js";
import { RunEvent } from "../domain/runEvent.js";
import { StateTransitionError } from "../utils/errors.js";

type TransitionTable = Map<RunState, Map<RunEvent, RunState>>;

function buildTransitionTable(): TransitionTable {
  const table: TransitionTable = new Map();

  function add(from: RunState, event: RunEvent, to: RunState): void {
    let stateMap = table.get(from);
    if (!stateMap) {
      stateMap = new Map();
      table.set(from, stateMap);
    }
    stateMap.set(event, to);
  }

  // Happy path
  add(RunState.Todo, RunEvent.RUN_REQUESTED, RunState.Planning);
  add(RunState.Planning, RunEvent.PLAN_CREATED, RunState.PlanReview);

  // Plan review phase: Codex reviews the plan before human sees it
  add(RunState.PlanReview, RunEvent.PLAN_REVIEW_APPROVED, RunState.AwaitingPlanApproval);
  add(RunState.PlanReview, RunEvent.PLAN_REVIEW_CHANGES_REQUESTED, RunState.PlanRevision);

  // Plan revision: planner revises (one cycle), then always to human approval
  add(RunState.PlanRevision, RunEvent.PLAN_REVISED, RunState.AwaitingPlanApproval);

  // Human approval
  add(RunState.AwaitingPlanApproval, RunEvent.PLAN_APPROVED, RunState.Implementing);
  add(RunState.AwaitingPlanApproval, RunEvent.PLAN_REJECTED, RunState.Planning);

  // Execution
  add(RunState.Implementing, RunEvent.EXECUTION_STARTED, RunState.Implementing);
  add(RunState.Implementing, RunEvent.EXECUTION_FINISHED, RunState.AIReview);

  // Code review
  add(RunState.AIReview, RunEvent.REVIEW_APPROVED, RunState.ReadyForHumanReview);
  add(RunState.AIReview, RunEvent.REVIEW_CHANGES_REQUESTED, RunState.AddressingReview);
  add(RunState.AddressingReview, RunEvent.REMEDIATION_FINISHED, RunState.AIReview);

  // Human final approval
  add(RunState.ReadyForHumanReview, RunEvent.HUMAN_APPROVED, RunState.Done);

  // Blocked transitions (any active state can be blocked)
  add(RunState.Todo, RunEvent.BLOCKED, RunState.AIBlocked);
  add(RunState.Planning, RunEvent.BLOCKED, RunState.AIBlocked);
  add(RunState.PlanReview, RunEvent.BLOCKED, RunState.AIBlocked);
  add(RunState.PlanRevision, RunEvent.BLOCKED, RunState.AIBlocked);
  add(RunState.AwaitingPlanApproval, RunEvent.BLOCKED, RunState.AIBlocked);
  add(RunState.Implementing, RunEvent.BLOCKED, RunState.AIBlocked);
  add(RunState.AIReview, RunEvent.BLOCKED, RunState.AIBlocked);
  add(RunState.AddressingReview, RunEvent.BLOCKED, RunState.AIBlocked);

  // Human clarification
  add(RunState.Todo, RunEvent.NEEDS_HUMAN_CLARIFICATION, RunState.HumanClarificationNeeded);
  add(RunState.Planning, RunEvent.NEEDS_HUMAN_CLARIFICATION, RunState.HumanClarificationNeeded);
  add(RunState.PlanReview, RunEvent.NEEDS_HUMAN_CLARIFICATION, RunState.HumanClarificationNeeded);
  add(
    RunState.AwaitingPlanApproval,
    RunEvent.NEEDS_HUMAN_CLARIFICATION,
    RunState.HumanClarificationNeeded,
  );

  // Recovery: RESET_TO_TODO always returns to Todo.
  // V1 limitation: prior meaningful state is not preserved. A future enhancement
  // could store previousState on the run and allow resuming from it, but that
  // adds significant complexity to the transition model. For now, the tradeoff
  // is acceptable -- the orchestrator can simply re-trigger the appropriate stage
  // after reset.
  add(RunState.AIBlocked, RunEvent.RESET_TO_TODO, RunState.Todo);
  add(RunState.HumanClarificationNeeded, RunEvent.RESET_TO_TODO, RunState.Todo);

  return table;
}

const TRANSITIONS = buildTransitionTable();

export function transition(currentState: RunState, event: RunEvent): RunState {
  const stateMap = TRANSITIONS.get(currentState);
  if (!stateMap) {
    throw new StateTransitionError(currentState, event);
  }
  const nextState = stateMap.get(event);
  if (nextState === undefined) {
    throw new StateTransitionError(currentState, event);
  }
  return nextState;
}

export function getValidEvents(state: RunState): RunEvent[] {
  const stateMap = TRANSITIONS.get(state);
  return stateMap ? Array.from(stateMap.keys()) : [];
}
