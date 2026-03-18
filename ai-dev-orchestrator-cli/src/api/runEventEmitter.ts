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
}
