export interface LinearIssue {
  id: string;
  /** Team issue key, e.g. "ENG-42" (from Linear `identifier`). */
  identifier?: string;
  title: string;
  description: string;
  branchName: string;
  state: string;
  labels: string[];
  priority: number;
  url?: string;
  project?: string;
  team?: string;
  cycle?: string;
}

/**
 * A Linear issue surfaced as background context for the focus issue
 * (e.g. its parent or a blocker). Captures the same descriptive fields
 * as `LinearIssue` plus the human-readable identifier (e.g. "PRY-123").
 */
export interface RelatedLinearIssue {
  id: string;
  identifier?: string;
  title: string;
  description: string;
  state: string;
  labels: string[];
  priority: number;
  url?: string;
}

export interface RelatedIssueContext {
  parent?: RelatedLinearIssue;
  blockers: RelatedLinearIssue[];
}

export interface IssueSearchFilter {
  /** Match issues belonging to a specific Linear project name (exact match). */
  projectName?: string;
  /** When true, match only issues assigned to the authenticated user. */
  assigneeMe?: boolean;
  /** Scope search to a specific Linear team name or key (e.g. "PRY"). */
  team?: string;
  /** Workflow state name to filter by (e.g. "Todo"). */
  state: string;
}

export interface LinearClient {
  getIssue(issueId: string): Promise<LinearIssue>;
  /**
   * Fetches the immediate parent issue and any direct blockers (issues that
   * block the focus issue) for use as background planning context. Implementations
   * SHOULD return an empty `blockers` array (rather than throwing) when the focus
   * issue exists but has no related issues.
   */
  getRelatedContext(issueId: string): Promise<RelatedIssueContext>;
  searchIssues(filter: IssueSearchFilter): Promise<LinearIssue[]>;
  postComment(issueId: string, body: string): Promise<void>;
  updateIssueState(issueId: string, state: string): Promise<void>;
  addLabel(issueId: string, label: string): Promise<void>;
  removeLabel(issueId: string, label: string): Promise<void>;
  listLabels(issueId: string): Promise<string[]>;
}

export class MockLinearClient implements LinearClient {
  private issues = new Map<string, LinearIssue>();
  private comments: { issueId: string; body: string }[] = [];
  private relations = new Map<string, RelatedIssueContext>();

  seedIssue(issue: LinearIssue): void {
    this.issues.set(issue.id, { ...issue });
  }

  /**
   * Test helper: associate a parent and/or blockers with an existing seeded issue.
   * Overwrites any previously-seeded relations for the same `issueId`.
   */
  seedRelations(issueId: string, related: RelatedIssueContext): void {
    this.relations.set(issueId, {
      parent: related.parent ? { ...related.parent } : undefined,
      blockers: related.blockers.map((b) => ({ ...b })),
    });
  }

  getPostedComments(): { issueId: string; body: string }[] {
    return [...this.comments];
  }

  getIssue(issueId: string): Promise<LinearIssue> {
    const issue = this.issues.get(issueId);
    if (!issue) {
      throw new Error(`Mock: Issue ${issueId} not found`);
    }
    return Promise.resolve({ ...issue });
  }

  getRelatedContext(issueId: string): Promise<RelatedIssueContext> {
    const seeded = this.relations.get(issueId);
    if (!seeded) {
      return Promise.resolve({ blockers: [] });
    }
    return Promise.resolve({
      parent: seeded.parent ? { ...seeded.parent } : undefined,
      blockers: seeded.blockers.map((b) => ({ ...b })),
    });
  }

  searchIssues(filter: IssueSearchFilter): Promise<LinearIssue[]> {
    const matches = [...this.issues.values()].filter((i) => {
      if (i.state !== filter.state) return false;
      if (filter.projectName && i.project !== filter.projectName) return false;
      return true;
    });
    return Promise.resolve(matches.map((i) => ({ ...i })));
  }

  postComment(issueId: string, body: string): Promise<void> {
    this.comments.push({ issueId, body });
    return Promise.resolve();
  }

  updateIssueState(issueId: string, state: string): Promise<void> {
    const issue = this.issues.get(issueId);
    if (issue) {
      issue.state = state;
    }
    return Promise.resolve();
  }

  addLabel(issueId: string, label: string): Promise<void> {
    const issue = this.issues.get(issueId);
    if (issue && !issue.labels.includes(label)) {
      issue.labels.push(label);
    }
    return Promise.resolve();
  }

  removeLabel(issueId: string, label: string): Promise<void> {
    const issue = this.issues.get(issueId);
    if (issue) {
      issue.labels = issue.labels.filter((l) => l !== label);
    }
    return Promise.resolve();
  }

  listLabels(issueId: string): Promise<string[]> {
    const issue = this.issues.get(issueId);
    return Promise.resolve(issue ? [...issue.labels] : []);
  }
}
