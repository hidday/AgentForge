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

export interface LinearClient {
  getIssue(issueId: string): Promise<LinearIssue>;
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
