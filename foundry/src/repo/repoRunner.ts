import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "../utils/logger.js";

export class RepoRunner {
  constructor(private readonly logger: Logger) {}

  ensureWorkingDirectory(basePath: string, branchName: string): string {
    const dir = resolve(basePath, branchName.replace(/[^a-zA-Z0-9_-]/g, "_"));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      this.logger.info({ dir }, "Created working directory");
    }
    return dir;
  }

  resolveRepoPath(basePath: string): string {
    const dir = resolve(basePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      this.logger.info({ dir }, "Created repo base path");
    }
    return dir;
  }
}
