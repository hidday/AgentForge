import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, isAbsolute } from "node:path";
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
  linearTeam: z.string().optional(),
  assigneeMe: z.boolean().optional(),
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
  private readonly teamMap: Map<string, RepoEntry>;
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
    // Index repos that use assigneeMe by their linearTeam key for routing
    this.teamMap = new Map(
      config.repos
        .filter((r): r is RepoEntry & { linearTeam: string } => r.linearTeam != null)
        .map((r) => [r.linearTeam, r]),
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

  resolveForIssue(project?: string, team?: string): RepoEntry {
    // 1. Try exact project name match first
    if (project) {
      const entry = this.projectMap.get(project);
      if (entry) {
        this.logger.debug({ project, repo: entry.name }, "Resolved repo from Linear project");
        return entry;
      }
    }

    // 2. Try team-based routing (used by repos configured with assigneeMe + linearTeam)
    if (team) {
      const entry = this.teamMap.get(team);
      if (entry) {
        this.logger.debug({ team, repo: entry.name }, "Resolved repo from Linear team");
        return entry;
      }
    }

    // 3. If project was provided but unmatched and no team fallback, throw to surface misconfiguration
    if (project && !team) {
      const configured = [...this.projectMap.keys()];
      throw new Error(
        `No repo mapped to Linear project "${project}". ` +
          `Configured projects: [${configured.join(", ")}]. ` +
          `Add a matching "linearProject" entry in repos.config.json.`,
      );
    }

    this.logger.debug(
      { fallback: this.defaultEntry.name },
      "Issue has no Linear project or team match, using default repo",
    );
    return this.defaultEntry;
  }

  resolveWorkingDirectory(entry: RepoEntry): string {
    if (isAbsolute(entry.directory)) {
      return resolve(entry.directory);
    }
    return resolve(join(this.reposRootPath, entry.directory));
  }

  validateWorkingDirectory(workingDirectory: string): void {
    if (!existsSync(workingDirectory)) {
      throw new Error(
        `Working directory does not exist: ${workingDirectory}. ` +
          `Ensure the repository is cloned at this path, or update repos.config.json and REPOS_ROOT_PATH.`,
      );
    }

    const gitDir = join(workingDirectory, ".git");
    if (!existsSync(gitDir)) {
      throw new Error(
        `Working directory is not a git repository: ${workingDirectory}. ` +
          `Expected a .git entry at ${gitDir}.`,
      );
    }

    // .git can be a directory (normal clone) or a file (worktree)
    const gitStat = statSync(gitDir);
    if (!gitStat.isDirectory() && !gitStat.isFile()) {
      throw new Error(
        `Working directory has invalid .git entry: ${gitDir}. ` +
          `Expected a directory (clone) or file (worktree).`,
      );
    }

    const stat = statSync(workingDirectory);
    if (!stat.isDirectory()) {
      throw new Error(`Working directory path is not a directory: ${workingDirectory}.`);
    }
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
  // Resolve the live config; if it's missing, transparently fall back to the
  // committed `*.example.json` template so a fresh clone boots without errors.
  // The user can copy and customize the example at their convenience.
  const resolvedPath = resolve(configPath);
  let effectivePath = resolvedPath;
  if (!existsSync(resolvedPath)) {
    const examplePath = resolvedPath.replace(/\.json$/, ".example.json");
    if (existsSync(examplePath)) {
      logger.warn(
        { expected: resolvedPath, fallback: examplePath },
        "repos.config.json not found -- falling back to the committed example. " +
          "Copy it and edit for your environment: cp foundry/repos.config.example.json foundry/repos.config.json",
      );
      effectivePath = examplePath;
    } else {
      throw new Error(
        `Repo config not found at ${resolvedPath} and no example fallback at ${examplePath}.`,
      );
    }
  }

  const raw = readFileSync(effectivePath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  const config = ReposConfigSchema.parse(parsed);

  logger.info(
    { configPath: effectivePath, repoCount: config.repos.length, defaultRepo: config.defaultRepo },
    "Loaded repo registry",
  );

  return new RepoRegistry(reposRootPath, config, logger);
}
