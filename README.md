This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Codex Development

This repository is configured for Codex development through `AGENTS.md`.

Before editing Next.js code, read the relevant guide under `node_modules/next/dist/docs/`; this project uses Next.js 16 and may differ from older Next.js conventions.

Common commands:

```bash
npm run dev
npm run build
npm run lint
npm run test:run
npm run test:e2e
```

To enable the local NexAuto MCP server in Codex:

```bash
codex mcp add nexauto -- node ./scripts/codex-mcp-nexauto.mjs
```

The MCP launcher reads `.env.local` and maps `NEXT_PUBLIC_SUPABASE_URL` to `SUPABASE_URL` when needed. Do not commit secrets from `.env.local` or `.mcp.json`.

Codex app-server is enabled through the standalone Codex install and a persistent local daemon:

```bash
codex app-server daemon bootstrap --remote-control
codex app-server daemon version
codex doctor
```

The daemon uses the local control socket at `~/.codex/app-server-control/app-server-control.sock`. Use `codex app-server daemon stop` to stop it and `codex remote-control start --json` to start it again with remote control enabled.

Superpowers design and planning artifacts live in `docs/superpowers/`; active SDD task notes live in `.superpowers/sdd/`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
