# Security policy

## Reporting a vulnerability

If you believe you've found a security issue in AgentForge, **please do not open a public GitHub issue**. Instead, report it privately:

- Open a [private security advisory](https://github.com/hidday/AgentForge/security/advisories/new) on this repository, or
- Email the maintainer directly at the address listed on the [`hidday`](https://github.com/hidday) GitHub profile.

You should expect an acknowledgement within 72 hours. Please include:

- A clear description of the issue and its impact.
- Steps to reproduce (proof-of-concept code, requests, or a minimal test repo).
- The commit SHA / version you tested against.
- Whether the issue has been disclosed to anyone else.

We commit to keeping you informed as we triage and fix the issue, and to crediting you (if you wish) in the release notes.

## Scope

The following components are in scope for security reports:

- The orchestrator service (`foundry/`) -- HTTP routes, webhook handlers, state machine, policy engine.
- The agent runtime layer (`foundry/src/runtime/`) -- subprocess invocation, output parsing, timeout handling.
- The UI (`ui/`) and its API client.
- The Prisma schema and migration logic.

The following are **not** in scope (please don't report them as AgentForge vulnerabilities):

- Issues in upstream CLIs (`claude`, `codex`, `agent`/Cursor) -- report those to their vendors.
- Issues in third-party Linear / GitHub services or SDKs -- report those to the respective providers.
- Issues that require a malicious local user with shell access on the host running AgentForge (see threat model below).

## Threat model

AgentForge is designed to run **on a trusted developer machine or a trusted CI/Ops host**. It is not a multi-tenant service.

Specifically:

- The HTTP server binds to `0.0.0.0:3100` by default; do not expose it to the public internet without an authenticating reverse proxy in front of it.
- The orchestrator spawns subprocesses with the credentials of the host user. Anyone who can reach the API or write to the host's filesystem can cause it to run arbitrary CLI commands.
- The Claude Code CLI is invoked with `--dangerously-skip-permissions` by default in `foundry/.env.example`. This is intentional for development on a personal machine but **must be reviewed before any deployment to a shared environment**. Tighten the args (`CLAUDE_CODE_ARGS_BASE`) or remove that flag for shared hosts.
- API tokens (`LINEAR_API_KEY`, `GITHUB_TOKEN`) are read from `.env` and have full account-level scopes against the configured services. Rotate immediately if any host running AgentForge is compromised, lost, or shared.
- Webhook handlers verify Linear's signature when a shared secret is configured; GitHub webhooks should always be configured with a shared secret. Unsigned webhooks are accepted in development for convenience -- do not run in that mode in production.

## Supported versions

AgentForge is pre-1.0. Only the latest commit on `master` is supported for security fixes. Once a stable release exists, this section will track the supported version window.

## Hardening checklist for deployers

If you decide to run AgentForge on a shared host:

- Put the Fastify backend behind an authenticating reverse proxy (basic auth, mTLS, or an OIDC proxy like oauth2-proxy).
- Restrict outbound network egress to the services AgentForge actually needs (Linear, GitHub, your CLI vendors' control planes).
- Run the process as a dedicated unprivileged user with a restricted `$HOME`.
- Mount the managed repos (`REPOS_ROOT_PATH`) on a filesystem with reasonable size and inode quotas.
- Review and tighten `CLAUDE_CODE_ARGS_BASE`, `CODEX_ARGS_BASE`, and `CURSOR_ARGS_BASE` to remove any flags that disable safety checks.
- Enable webhook signature verification on every webhook source.
- Use short-lived, narrowly-scoped tokens for `LINEAR_API_KEY` and `GITHUB_TOKEN`. Rotate regularly.
