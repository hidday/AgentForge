import { EventEmitter } from "node:events";

export type DashboardEvent =
  | {
      type: "run:state-changed";
      runId: string;
      from: string;
      to: string;
      timestamp: string;
    }
  | {
      type: "run:artifact-created";
      runId: string;
      artifactType: string;
      version: number;
      timestamp: string;
    }
  | {
      type: "run:created";
      runId: string;
      issueId: string;
      repo: string;
      timestamp: string;
    }
  | {
      type: "process:started";
      runId: string;
      processId: string;
      stage: string;
      runtime: string;
      command: string;
      timestamp: string;
    }
  | {
      type: "process:output";
      runId: string;
      processId: string;
      chunk: string;
      timestamp: string;
    }
  | {
      type: "process:completed";
      runId: string;
      processId: string;
      stage: string;
      runtime: string;
      exitCode: number;
      durationMs: number;
      timestamp: string;
    }
  | {
      type: "run:questions-answered";
      runId: string;
      questionCount: number;
      timestamp: string;
    };

export class RunEventEmitter extends EventEmitter {
  emitStateChanged(runId: string, from: string, to: string): void {
    const event: DashboardEvent = {
      type: "run:state-changed",
      runId,
      from,
      to,
      timestamp: new Date().toISOString(),
    };
    this.emit("dashboard", event);
  }

  emitArtifactCreated(runId: string, artifactType: string, version: number): void {
    const event: DashboardEvent = {
      type: "run:artifact-created",
      runId,
      artifactType,
      version,
      timestamp: new Date().toISOString(),
    };
    this.emit("dashboard", event);
  }

  emitRunCreated(runId: string, issueId: string, repo: string): void {
    const event: DashboardEvent = {
      type: "run:created",
      runId,
      issueId,
      repo,
      timestamp: new Date().toISOString(),
    };
    this.emit("dashboard", event);
  }

  emitProcessStarted(
    runId: string,
    processId: string,
    stage: string,
    runtime: string,
    command: string,
  ): void {
    const event: DashboardEvent = {
      type: "process:started",
      runId,
      processId,
      stage,
      runtime,
      command,
      timestamp: new Date().toISOString(),
    };
    this.emit("dashboard", event);
  }

  emitProcessOutput(runId: string, processId: string, chunk: string): void {
    const event: DashboardEvent = {
      type: "process:output",
      runId,
      processId,
      chunk,
      timestamp: new Date().toISOString(),
    };
    this.emit("dashboard", event);
  }

  emitProcessCompleted(
    runId: string,
    processId: string,
    stage: string,
    runtime: string,
    exitCode: number,
    durationMs: number,
  ): void {
    const event: DashboardEvent = {
      type: "process:completed",
      runId,
      processId,
      stage,
      runtime,
      exitCode,
      durationMs,
      timestamp: new Date().toISOString(),
    };
    this.emit("dashboard", event);
  }

  emitQuestionsAnswered(runId: string, questionCount: number): void {
    const event: DashboardEvent = {
      type: "run:questions-answered",
      runId,
      questionCount,
      timestamp: new Date().toISOString(),
    };
    this.emit("dashboard", event);
  }
}
