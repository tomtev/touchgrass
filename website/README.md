# touchgrass website

Hono SSR landing page for Cloudflare Workers.

## Stack

- Hono (SSR on Worker)
- Tailwind CSS v4
- shadcn-style UI components

## Run locally

```bash
cd website
npm install
npm run dev
```

The dev script runs Tailwind in watch mode and `wrangler dev` in parallel.

## Build and deploy

```bash
npm run build
npm run deploy
```

`npm run build` compiles Tailwind CSS and runs a Worker dry-run deploy.
