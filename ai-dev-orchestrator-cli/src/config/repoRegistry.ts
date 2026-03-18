import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { z } from "zod";
import type { Logger } from "../utils/logger.js";

const RepoConstraintsSchema = z.object({
  requiredChecks: z.array(z.string()),
  maxFilesChanged: z.number().int().positive(),
  maxDiffLines: z.number().int().positive(),
  forbiddenPatterns: z.array(z.string()),
  mustNotTouch: z.array(z.string()),
});

const RepoEntrySchema = z.object({
  name: z.string(),
  directory: z.string(),
  linearProject: z.string().optional(),
  defaultBranch: z.string().default("main"),
  allowedPaths: z.array(z.string()),
  protectedPaths: z.array(z.string()),
  constraints: RepoConstraintsSchema,
});

const ReposConfigSchema = z.object({
  repos: z.array(RepoEntrySchema).min(1),
  defaultRepo: z.string(),
});

export type RepoEntry = z.infer<typeof RepoEntrySchema>;
export type RepoConstraints = z.infer<typeof RepoConstraintsSchema>;
export type ReposConfig = z.infer<typeof ReposConfigSchema>;

export class RepoRegistry {
  private readonly entries: Map<string, RepoEntry>;
  private readonly projectMap: Map<string, RepoEntry>;
  private readonly defaultEntry: RepoEntry;

  constructor(
    private readonly reposRootPath: string,
    config: ReposConfig,
    private readonly logger: Logger,
  ) {
    this.entries = new Map(config.repos.map((r) => [r.name, r]));
    this.projectMap = new Map(
      config.repos
        .filter((r): r is RepoEntry & { linearProject: string } => r.linearProject != null)
        .map((r) => [r.linearProject, r]),
    );

    const defaultEntry = this.entries.get(config.defaultRepo);
    if (!defaultEntry) {
      throw new Error(
        `Default repo "${config.defaultRepo}" not found in registry. Available: ${[...this.entries.keys()].join(", ")}`,
      );
    }
    this.defaultEntry = defaultEntry;
  }

  getRepoByName(name: string): RepoEntry | undefined {
    return this.entries.get(name);
  }

  getRepoByLinearProject(project: string): RepoEntry | undefined {
    return this.projectMap.get(project);
  }

  getDefaultRepo(): RepoEntry {
    return this.defaultEntry;
  }

  resolveForIssue(project?: string): RepoEntry {
    if (project) {
      const entry = this.projectMap.get(project);
      if (entry) {
        this.logger.debug({ project, repo: entry.name }, "Resolved repo from Linear project");
        return entry;
      }
      this.logger.warn(
        { project, fallback: this.defaultEntry.name },
        "No repo mapped to Linear project, using default",
      );
    }
    return this.defaultEntry;
  }

  resolveWorkingDirectory(entry: RepoEntry): string {
    return resolve(join(this.reposRootPath, entry.directory));
  }

  listRepos(): RepoEntry[] {
    return [...this.entries.values()];
  }
}

export function loadRepoRegistry(
  configPath: string,
  reposRootPath: string,
  logger: Logger,
): RepoRegistry {
  const raw = readFileSync(resolve(configPath), "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  const config = ReposConfigSchema.parse(parsed);

  logger.info(
    { configPath, repoCount: config.repos.length, defaultRepo: config.defaultRepo },
    "Loaded repo registry",
  );

  return new RepoRegistry(reposRootPath, config, logger);
}
