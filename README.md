# AgentForge

## Prerequisites

### Node.js

**Node.js >=22.12.0** is required (Vite 6 requires Node 20.19+/22.12+).

Install and activate via [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 22 && nvm use
```

A `.nvmrc` file is present at the repo root — running `nvm use` (or `fnm use`)
from the repo root will automatically switch to the correct version.

> **Apple Silicon (M1/M2/M3) note:** Node.js must be the **native arm64 build**.
> If Node was installed inside a Rosetta/x64 terminal session, the wrong
> architecture will be active and `npm run dev` will fail with an esbuild
> platform-mismatch error. Make sure you run `nvm install 22 && nvm use` from a
> **native arm64 terminal** (e.g., a default macOS Terminal or iTerm2 window —
> *not* one launched with "Open using Rosetta").
