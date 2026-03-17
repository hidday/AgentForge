export interface PRComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface GitHubClient {
  createBranch(repo: string, branchName: string): Promise<void>;
  createDraftPR(
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string,
  ): Promise<number>;
  commentOnPR(repo: string, prNumber: number, body: string): Promise<void>;
  getPRDiff(repo: string, prNumber: number): Promise<string>;
  markPRReady(repo: string, prNumber: number): Promise<void>;
  listPRComments(repo: string, prNumber: number): Promise<PRComment[]>;
}

export class MockGitHubClient implements GitHubClient {
  private nextPrNumber = 100;
  private branches: string[] = [];
  private prs = new Map<
    number,
    { repo: string; head: string; base: string; title: string; body: string; draft: boolean }
  >();
  private prComments: { prNumber: number; body: string }[] = [];

  getCreatedBranches(): string[] {
    return [...this.branches];
  }

  getCreatedPRs(): Map<number, { repo: string; head: string; title: string; draft: boolean }> {
    return new Map(
      [...this.prs.entries()].map(([num, pr]) => [
        num,
        { repo: pr.repo, head: pr.head, title: pr.title, draft: pr.draft },
      ]),
    );
  }

  createBranch(_repo: string, branchName: string): Promise<void> {
    this.branches.push(branchName);
    return Promise.resolve();
  }

  createDraftPR(
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string,
  ): Promise<number> {
    const prNumber = this.nextPrNumber++;
    this.prs.set(prNumber, { repo, head, base, title, body, draft: true });
    return Promise.resolve(prNumber);
  }

  commentOnPR(_repo: string, prNumber: number, body: string): Promise<void> {
    this.prComments.push({ prNumber, body });
    return Promise.resolve();
  }

  getPRDiff(_repo: string, _prNumber: number): Promise<string> {
    return Promise.resolve(
      [
        "diff --git a/src/handler.ts b/src/handler.ts",
        "index abc1234..def5678 100644",
        "--- a/src/handler.ts",
        "+++ b/src/handler.ts",
        "@@ -10,6 +10,15 @@",
        " import { validate } from './validate';",
        " ",
        "+export async function handleRequest(req: Request): Promise<Response> {",
        "+  const body = await req.json();",
        "+  const validated = validate(body);",
        "+  if (!validated.success) {",
        "+    return new Response('Invalid input', { status: 400 });",
        "+  }",
        "+  const result = await processData(validated.data);",
        "+  return Response.json(result);",
        "+}",
      ].join("\n"),
    );
  }

  markPRReady(_repo: string, prNumber: number): Promise<void> {
    const pr = this.prs.get(prNumber);
    if (pr) {
      pr.draft = false;
    }
    return Promise.resolve();
  }

  listPRComments(_repo: string, _prNumber: number): Promise<PRComment[]> {
    return Promise.resolve([]);
  }
}
