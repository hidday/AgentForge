# AgentForge

## Prerequisites

- **Node.js >=22.12.0** — required by Vite (20.19+ or 22.12+) and by the native esbuild binaries used in the backend.
  - A `.nvmrc` file is present at the repo root. Run `nvm use` (or `fnm use`) to automatically switch to Node 22.
  - To install: `nvm install 22 && nvm use`
  - **Apple Silicon (M1/M2/M3) users**: Node.js must be the **native arm64 build**. If you installed Node inside a Rosetta/x64 terminal, esbuild will fail with a platform-mismatch error. To fix: open a native arm64 terminal (default Terminal.app on Apple Silicon), then re-run `nvm install 22 && nvm use`.

