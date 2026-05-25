# AgentForge UI

The live dashboard for AgentForge. Watch runs progress through the state machine, review every artifact (plan, plan review, plan revision, execution report, code review, remediation), and chat ad-hoc with a run-scoped agent -- all backed by the same Postgres the orchestrator writes to.

For the project overview, see the [root README](../README.md). For backend internals, see [`foundry/README.md`](../foundry/README.md).

## What's in here

| Route | Component | Purpose |
|---|---|---|
| `/` | [`DashboardPage`](src/pages/DashboardPage.tsx) | Sortable runs table, active processes, recent events, manual issue ingest. |
| `/runs/:id` | [`RunDetailPage`](src/pages/RunDetailPage.tsx) | Per-run timeline, workflow stepper, artifact tabs, action bar (approve / reject / request human / answer questions / restart), and run-scoped chat. |

Notable components:

- [`WorkflowStepper`](src/components/WorkflowStepper.tsx) -- visual state machine with the run's current position.
- [`ArtifactTabs`](src/components/ArtifactTabs.tsx) -- typed viewers for `Plan`, `PlanReview`, `PlanRevision`, `ExecutionReport`, `Review`, `Remediation`.
- [`AgentOutputPanel`](src/components/AgentOutputPanel.tsx) -- streams the active CLI subprocess output via Server-Sent Events.
- [`ChatPanel`](src/components/ChatPanel.tsx) -- run-scoped chat that talks to the orchestrator's chat endpoint with the run's context bundle prebuilt.

## Tech stack

React 19, Vite 8, TypeScript, Tailwind CSS 4, React Router 7, react-markdown + remark-gfm, lucide-react icons. Tests via Vitest + React Testing Library.

## Run it

The simplest path is from the repo root:

```bash
nvm use
npm run dev   # boots Fastify on :3100 and Vite on :5173 together
```

To run the UI on its own (assumes the Fastify backend is already up on `localhost:3100`):

```bash
cd ui
npm install
npm run dev
```

The dev server listens on `http://localhost:5173`. `vite.config.ts` proxies `/api/*` to the Fastify backend so you don't need to thread any base-URL env var through the client.

To open the dev server from another device on your LAN/VPN, set `VITE_ALLOWED_HOSTS` to a comma-separated list of hostnames before starting Vite -- the config reads it directly:

```bash
VITE_ALLOWED_HOSTS=mac.tail-net.ts.net,192.168.1.42 npm run dev
```

## Backend contract

The UI talks to the same Fastify app served from `foundry/`. The thin client is in [`src/api/client.ts`](src/api/client.ts), and live updates come over SSE via [`src/hooks/useSSE.ts`](src/hooks/useSSE.ts). Routes consumed:

- `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/events`, `GET /api/runs/:id/artifacts`
- `POST /api/runs/:id/actions/{approve-plan,reject-plan,request-human,answer-questions,restart}`
- `POST /api/runs/:id/chat`
- `GET /api/processes` (active CLI subprocesses)
- `GET /api/sse/runs/:id` (live events for a single run)

See [`foundry/src/api/routes.ts`](../foundry/src/api/routes.ts) for the full surface.

## Tests

```bash
cd ui && npm test
```

Tests live next to the components they cover (`*.test.tsx`). Vitest config is in [`vitest.config.ts`](vitest.config.ts); jsdom is the default environment.

## Build

```bash
cd ui && npm run build
```

Outputs static assets to `dist/`. Serve them behind any static host -- they'll happily call a Fastify backend on the same origin (or a different one, with the proxy adjusted).
