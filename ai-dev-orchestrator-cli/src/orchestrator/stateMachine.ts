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
  add(RunState.Planning, RunEvent.PLAN_CREATED, RunState.AwaitingPlanApproval);
  add(RunState.AwaitingPlanApproval, RunEvent.PLAN_APPROVED, RunState.Implementing);
  add(RunState.AwaitingPlanApproval, RunEvent.PLAN_REJECTED, RunState.Planning);
  add(RunState.Implementing, RunEvent.EXECUTION_STARTED, RunState.Implementing);
  add(RunState.Implementing, RunEvent.EXECUTION_FINISHED, RunState.AIReview);
  add(RunState.AIReview, RunEvent.REVIEW_COMPLETED, RunState.ReadyForHumanReview);
  add(RunState.AIReview, RunEvent.REVIEW_FINDINGS_EXIST, RunState.AddressingReview);
  add(RunState.AddressingReview, RunEvent.REMEDIATION_FINISHED, RunState.AIReview);
  add(RunState.ReadyForHumanReview, RunEvent.HUMAN_APPROVED, RunState.Done);

  // Blocked transitions
  add(RunState.Todo, RunEvent.BLOCKED, RunState.AIBlocked);
  add(RunState.Planning, RunEvent.BLOCKED, RunState.AIBlocked);
  add(RunState.Implementing, RunEvent.BLOCKED, RunState.AIBlocked);
  add(RunState.AIReview, RunEvent.BLOCKED, RunState.AIBlocked);
  add(RunState.AddressingReview, RunEvent.BLOCKED, RunState.AIBlocked);

  // Human clarification
  add(RunState.Todo, RunEvent.NEEDS_HUMAN_CLARIFICATION, RunState.HumanClarificationNeeded);
  add(RunState.Planning, RunEvent.NEEDS_HUMAN_CLARIFICATION, RunState.HumanClarificationNeeded);

  // Recovery
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
