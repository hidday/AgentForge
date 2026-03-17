import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { logger } from "../src/utils/logger.js";
import { parseBaseArgs } from "../src/config/env.js";
import { RunRepository } from "../src/orchestrator/runRepository.js";
import { ArtifactRepository } from "../src/orchestrator/artifactRepository.js";
import { EventRepository } from "../src/orchestrator/eventRepository.js";
import { OrchestratorService } from "../src/orchestrator/orchestratorService.js";
import { ProcessRunner } from "../src/runtime/processRunner.js";
import { ClaudeCodeRunner } from "../src/runtime/claudeCodeRunner.js";
import { CodexRunner } from "../src/runtime/codexRunner.js";
import { AgentRunner } from "../src/runtime/agentRunner.js";
import { PlannerAgent } from "../src/agents/plannerAgent.js";
import { PlanReviewerAgent } from "../src/agents/planReviewerAgent.js";
import { PlanReviserAgent } from "../src/agents/planReviserAgent.js";
import { ExecutorAgent } from "../src/agents/executorAgent.js";
import { ReviewerAgent } from "../src/agents/reviewerAgent.js";
import { RemediationAgent } from "../src/agents/remediationAgent.js";
import { MockLinearClient } from "../src/linear/linearClient.js";
import { MockGitHubClient } from "../src/github/githubClient.js";
import { createMockProcessHandler } from "../src/mocks/mockCliOutputs.js";
import { MOCK_ISSUE } from "../src/mocks/mockLinearData.js";

const DIVIDER = "=".repeat(72);
const SECTION = "-".repeat(72);

function header(title: string): void {
  console.log(`\n${DIVIDER}`);
  console.log(`  ${title}`);
  console.log(DIVIDER);
}

function section(title: string): void {
  console.log(`\n${SECTION}`);
  console.log(`  ${title}`);
  console.log(SECTION);
}

async function simulate(): Promise<void> {
  header("AI Dev Orchestrator -- Full Workflow Simulation (Mock Mode)");

  const prisma = new PrismaClient();

  try {
    const runRepo = new RunRepository(prisma);
    const artifactRepo = new ArtifactRepository(prisma);
    const eventRepo = new EventRepository(prisma);

    const processRunner = new ProcessRunner("mock", logger);
    processRunner.setMockHandler(createMockProcessHandler());

    const claudeCodeRunner = new ClaudeCodeRunner(
      processRunner, "claude", parseBaseArgs("--print --output-format json"), logger,
    );
    const codexRunner = new CodexRunner(
      processRunner, "codex", parseBaseArgs("--approval-mode full-auto -q"), logger,
    );
    const agentRunner = new AgentRunner(claudeCodeRunner, codexRunner, logger);

    const githubClient = new MockGitHubClient();
    const plannerAgent = new PlannerAgent(agentRunner, artifactRepo, logger);
    const planReviewerAgent = new PlanReviewerAgent(agentRunner, artifactRepo, logger);
    const planReviserAgent = new PlanReviserAgent(agentRunner, artifactRepo, logger);
    const executorAgent = new ExecutorAgent(agentRunner, artifactRepo, githubClient, logger);
    const reviewerAgent = new ReviewerAgent(agentRunner, artifactRepo, logger);
    const remediationAgent = new RemediationAgent(agentRunner, artifactRepo, logger);

    const linearClient = new MockLinearClient();
    linearClient.seedIssue(MOCK_ISSUE);

    const orchestrator = new OrchestratorService({
      runRepo,
      artifactRepo,
      eventRepo,
      linearClient,
      githubClient,
      plannerAgent,
      planReviewerAgent,
      planReviserAgent,
      executorAgent,
      reviewerAgent,
      remediationAgent,
      logger,
    });

    // Step 1: Start run
    // This chains: planning -> plan review (Codex) -> plan revision (Claude) -> AwaitingPlanApproval
    section("Step 1: Start Run -> Plan -> AI Plan Review -> Plan Revision -> AwaitingPlanApproval");
    console.log(`Issue: ${MOCK_ISSUE.id} -- "${MOCK_ISSUE.title}"`);
    const run = await orchestrator.startRun(MOCK_ISSUE.id);
    console.log(`Run ID: ${run.id}`);
    console.log(`State: ${run.state}`);
    console.log(`Plan version: ${run.planVersion} (revised after AI review)`);

    // Step 2: Explicit plan approval
    section("Step 2: Human Approves Plan -> Implementing");
    const approvedRun = await orchestrator.approvePlan(run.id);
    console.log(`State: ${approvedRun.state}`);
    console.log(`Approved plan version: ${approvedRun.approvedPlanVersion}`);

    // Step 3: Execution -> code review -> remediation -> re-review -> ready
    section("Step 3: Execute -> Code Review -> Remediation -> Re-review -> Ready");
    console.log("Chains: execution -> first code review (changes_requested)");
    console.log("  -> remediation -> second code review (approved) -> ready for human review");
    const finalRun = await orchestrator.runExecution(run.id);
    console.log(`Final state: ${finalRun.state}`);

    // Show artifacts
    section("Artifacts Created");
    const artifacts = await artifactRepo.findByRunId(run.id);
    for (const a of artifacts) {
      console.log(
        `  [${a.type.padEnd(24)}] v${a.version} -- ${a.rawText.slice(0, 70).replace(/\n/g, " ")}...`,
      );
    }

    // Show events
    section("Event Log");
    const events = await eventRepo.findByRunId(run.id);
    for (const e of events) {
      const payload = e.payloadJson as Record<string, unknown> | undefined;
      const from = payload?.["from"] ?? "-";
      const to = payload?.["to"] ?? "-";
      console.log(`  ${e.eventType.padEnd(34)} ${String(from).padEnd(22)} -> ${to}  (${e.source})`);
    }

    // Show Linear comments
    section("Linear Comments Posted");
    const comments = linearClient.getPostedComments();
    for (const c of comments) {
      const preview = c.body.split("\n")[0]?.slice(0, 80) ?? "";
      console.log(`  [${c.issueId}] ${preview}...`);
    }

    header("Simulation Complete");
    console.log(`\n  Final run state: ${finalRun.state}`);
    console.log(`  Artifacts: ${artifacts.length}`);
    console.log(`  Events: ${events.length}`);
    console.log(`  Linear comments: ${comments.length}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

simulate().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});
