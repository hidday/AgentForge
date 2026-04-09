export interface LinearIssue {
  id: string;
  title: string;
  description: string;
  state: string;
  labels: string[];
  priority: number;
  project?: string;
  cycle?: string;
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

  seedIssue(issue: LinearIssue): void {
    this.issues.set(issue.id, { ...issue });
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
