export enum RunState {
  Todo = "Todo",
  Planning = "Planning",
  AwaitingPlanApproval = "AwaitingPlanApproval",
  Implementing = "Implementing",
  AIReview = "AIReview",
  AddressingReview = "AddressingReview",
  ReadyForHumanReview = "ReadyForHumanReview",
  Done = "Done",
  AIBlocked = "AIBlocked",
  HumanClarificationNeeded = "HumanClarificationNeeded",
}
