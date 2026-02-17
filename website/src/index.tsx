import type { Context } from "hono";
import { Hono } from "hono";
import { raw } from "hono/html";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Bindings = {
  ASSETS: Fetcher;
};

type Env = {
  Bindings: Bindings;
};

const app = new Hono<Env>();

const emojiFavicon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ctext y='50' font-size='50'%3E%E2%9B%B3%EF%B8%8F%3C/text%3E%3C/svg%3E";

const grassScript = String.raw`(() => {
  const stage = document.getElementById("hero-grass-stage");
  const skyEl = document.getElementById("ascii-sky");
  const cloudEl = document.getElementById("ascii-clouds");
  const sunEl = document.getElementById("ascii-sun");
  const grassEl = document.getElementById("grass-grid");
  if (!stage || !skyEl || !cloudEl || !sunEl || !grassEl) return;

  const SKY_CHARS = [" ", " ", " ", ".", "'", ":"];
  const CLOUD_CHARS = [".", "o", "~"];
  const GRASS_CHARS = ["'", ",", ";", ":", ".", "^"];
  const TOUCHED_CHARS = [" ", ".", "_"];
  let cellWidth = 8;
  let cellHeight = 12;

  let cols = 0;
  let rows = 0;
  let skyCells = [];
  let sunCells = [];
  let grassCells = [];
  let decay = new Uint8Array(0);
  let latestX = 0;
  let latestY = 0;
  let rafQueued = false;
  let tick = 0;

  const rand = (arr) => arr[(Math.random() * arr.length) | 0];
  const indexOf = (r, c) => r * cols + c;
  const inBounds = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols;

  function measureCell() {
    const probe = document.createElement("span");
    probe.textContent = "0000000000";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    grassEl.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    grassEl.removeChild(probe);

    const computed = getComputedStyle(grassEl);
    const measuredWidth = rect.width > 0 ? rect.width / 10 : 8;
    const measuredHeight = Number.parseFloat(computed.lineHeight || "0") || 12;
    cellWidth = Math.max(4, measuredWidth);
    cellHeight = Math.max(8, measuredHeight);
  }

  function createBuffer(fill = " ") {
    return new Array(rows * cols).fill(fill);
  }

  function renderTo(el, buffer) {
    const lines = new Array(rows);
    for (let r = 0; r < rows; r += 1) {
      let line = "";
      const start = r * cols;
      for (let c = 0; c < cols; c += 1) line += buffer[start + c];
      lines[r] = line;
    }
    el.textContent = lines.join("\n");
  }

  function baseGrassChar(row) {
    const y = row / Math.max(1, rows - 1);
    if (y < 0.42) return " ";
    if (y < 0.58) return Math.random() < 0.11 ? rand([".", ":"]) : " ";
    if (y < 0.72) return Math.random() < 0.38 ? rand([".", ":", ";"]) : " ";
    return rand(GRASS_CHARS);
  }

  function buildSky() {
    skyCells = createBuffer(" ");
    const horizon = Math.floor(rows * 0.63);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const idx = indexOf(r, c);
        if (r < horizon) {
          const density = 0.03 + (r / Math.max(1, horizon)) * 0.02;
          skyCells[idx] = Math.random() < density ? rand(SKY_CHARS) : " ";
        } else {
          const density = 0.06 + ((r - horizon) / Math.max(1, rows - horizon)) * 0.08;
          skyCells[idx] = Math.random() < density ? rand([".", ":", "·"]) : " ";
        }
      }
    }
  }

  function buildSun() {
    sunCells = createBuffer(" ");
    const cx = Math.floor(cols * 0.79);
    const cy = Math.floor(rows * 0.2);
    const radius = Math.max(3, Math.floor(Math.min(cols, rows) * 0.065));

    for (let r = cy - radius - 2; r <= cy + radius + 2; r += 1) {
      for (let c = cx - radius - 4; c <= cx + radius + 4; c += 1) {
        if (!inBounds(r, c)) continue;
        const dx = c - cx;
        const dy = (r - cy) * 1.25;
        const d = Math.sqrt(dx * dx + dy * dy);
        const idx = indexOf(r, c);
        if (d < radius * 0.45) sunCells[idx] = "@";
        else if (d < radius * 0.8) sunCells[idx] = "O";
        else if (d < radius * 1.05) sunCells[idx] = "o";
        else if (d < radius * 1.4 && Math.random() < 0.35) sunCells[idx] = ".";
      }
    }
  }

  function buildGrass() {
    grassCells = createBuffer(" ");
    decay = new Uint8Array(rows * cols);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        grassCells[indexOf(r, c)] = baseGrassChar(r);
      }
    }
  }

  function buildCloudFrame(frame) {
    const clouds = createBuffer(" ");
    const bands = [
      { y: 0.12, phase: 0.5, speed: 0.65, threshold: 1.05 },
      { y: 0.2, phase: 1.2, speed: 0.52, threshold: 1.0 },
      { y: 0.3, phase: 2.1, speed: 0.44, threshold: 1.12 },
    ];

    for (const band of bands) {
      const center = Math.floor(rows * band.y);
      for (let c = 0; c < cols; c += 1) {
        const shift = frame * band.speed;
        const wave =
          Math.sin((c + shift) / 6 + band.phase) +
          Math.sin((c + shift) / 13 + band.phase * 1.7);
        if (wave <= band.threshold) continue;

        for (let dy = -1; dy <= 1; dy += 1) {
          const r = center + dy;
          if (!inBounds(r, c)) continue;
          if (Math.random() < (dy === 0 ? 0.82 : 0.4)) {
            clouds[indexOf(r, c)] = dy === 0 ? rand(CLOUD_CHARS) : ".";
          }
        }
      }
    }

    renderTo(cloudEl, clouds);
  }

  function twinkleSky() {
    const swaps = Math.max(3, Math.floor(cols * 0.015));
    const maxRow = Math.max(1, Math.floor(rows * 0.35));
    for (let i = 0; i < swaps; i += 1) {
      const r = Math.floor(Math.random() * maxRow);
      const c = Math.floor(Math.random() * cols);
      const idx = indexOf(r, c);
      skyCells[idx] = skyCells[idx] === " " ? rand([".", "'", ":"]) : " ";
    }
    renderTo(skyEl, skyCells);
  }

  function rebuild() {
    measureCell();
    const rect = grassEl.getBoundingClientRect();
    const nextCols = Math.max(24, Math.ceil(rect.width / cellWidth) + 2);
    const nextRows = Math.max(18, Math.ceil(rect.height / cellHeight));
    if (nextCols === cols && nextRows === rows) return;

    cols = nextCols;
    rows = nextRows;
    buildSky();
    buildSun();
    buildGrass();
    renderTo(skyEl, skyCells);
    renderTo(sunEl, sunCells);
    renderTo(grassEl, grassCells);
    buildCloudFrame(tick);
  }

  function touchAt(r, c) {
    if (r < Math.floor(rows * 0.38)) return;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const rr = r + dr;
        const cc = c + dc;
        if (!inBounds(rr, cc)) continue;
        if (Math.random() < 0.34) continue;
        const idx = indexOf(rr, cc);
        grassCells[idx] = rand(TOUCHED_CHARS);
        decay[idx] = Math.max(decay[idx], 4 + ((Math.random() * 11) | 0));
      }
    }
    renderTo(grassEl, grassCells);
  }

  function pointerToCell(clientX, clientY) {
    const rect = grassEl.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null;
    }
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const c = Math.max(0, Math.min(cols - 1, Math.floor((x / rect.width) * cols)));
    const r = Math.max(0, Math.min(rows - 1, Math.floor((y / rect.height) * rows)));
    return [r, c];
  }

  function flushPointer() {
    rafQueued = false;
    const cell = pointerToCell(latestX, latestY);
    if (!cell) return;
    touchAt(cell[0], cell[1]);
  }

  function queuePointer(e) {
    latestX = e.clientX;
    latestY = e.clientY;
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(flushPointer);
  }

  setInterval(() => {
    tick += 1;
    buildCloudFrame(tick);

    let grassChanged = false;
    for (let i = 0; i < decay.length; i += 1) {
      if (decay[i] > 0) {
        decay[i] -= 1;
        if (decay[i] === 0) {
          const row = Math.floor(i / cols);
          grassCells[i] = baseGrassChar(row);
          grassChanged = true;
        }
      }
    }
    if (grassChanged) renderTo(grassEl, grassCells);

    if (tick % 10 === 0) twinkleSky();
  }, 90);

  stage.addEventListener("pointermove", queuePointer, { passive: true });
  stage.addEventListener("pointerdown", queuePointer, { passive: true });
  window.addEventListener("resize", rebuild, { passive: true });

  rebuild();
})();`;

async function serveAsset(c: Context<Env>, pathname: string) {
  const assetUrl = new URL(c.req.url);
  assetUrl.pathname = pathname;
  return c.env.ASSETS.fetch(new Request(assetUrl.toString(), c.req.raw));
}

app.get("/styles.css", (c) => serveAsset(c, "/styles.css"));

app.get("/", (c) => {
  return c.html(
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>touchgrass.sh</title>
        <meta name="description" content="Remote controller for Claude Code & Codex" />
        <link rel="icon" href={emojiFavicon} />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <main class="min-h-screen bg-[#d9e4df]">
          <div class="mx-auto max-w-6xl px-6 py-14 lg:px-8">
            <header class="mb-10 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <span class="text-2xl" aria-hidden="true">⛳️</span>
                <div>
                  <p class="font-headline text-sm tracking-wide text-muted-foreground">touchgrass.sh</p>
                  <p class="text-xs text-muted-foreground">Cloudflare Worker + Hono SSR</p>
                </div>
              </div>
              <Badge class="bg-primary/10 text-primary">WIP</Badge>
            </header>

            <section
              id="hero-grass-stage"
              class="hero-ascii-stage relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] mb-14 min-h-[34rem] w-screen overflow-hidden border-y border-emerald-900/35 text-emerald-200"
            >
              <pre id="ascii-sky" class="hero-ascii-layer hero-ascii-sky px-0 py-4 text-[12px] leading-[12px]"></pre>
              <pre id="ascii-clouds" class="hero-ascii-layer hero-ascii-clouds px-0 py-4 text-[12px] leading-[12px]"></pre>
              <pre id="ascii-sun" class="hero-ascii-layer hero-ascii-sun px-0 py-4 text-[12px] leading-[12px]"></pre>
              <pre id="grass-grid" class="hero-ascii-layer hero-grass-layer px-0 py-4 text-[12px] leading-[12px]"></pre>

              <div class="relative z-10 mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-2 lg:items-center lg:px-8">
                <Card class="overflow-hidden border-emerald-200/30 bg-black/50 backdrop-blur">
                  <CardHeader class="pb-3">
                    <Badge class="w-fit border-emerald-300/40 bg-emerald-500/15 text-emerald-100">Telegram-first control plane</Badge>
                    <CardTitle class="font-headline text-4xl leading-tight tracking-tight text-balance text-white sm:text-5xl">
                      Remote controller for Claude Code &amp; Codex
                    </CardTitle>
                  </CardHeader>
                  <CardContent class="space-y-6">
                    <p class="max-w-xl text-lg text-emerald-100/90">
                      Launch sessions, route chat input, and keep long-running workflows alive from anywhere.
                      Move your cursor across this hero to literally touch grass.
                    </p>
                    <div class="flex flex-wrap gap-3">
                      <Button href="https://github.com/tomtev/touchgrass" target="_blank" rel="noreferrer">
                        View on GitHub
                      </Button>
                      <Button variant="outline" href="#quickstart" class="border-emerald-200/50 bg-white/5 text-emerald-50 hover:bg-white/15">
                        Quickstart
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card class="overflow-hidden border-emerald-200/30 bg-black/45 backdrop-blur">
                  <CardHeader class="pb-3">
                    <CardTitle class="font-headline text-emerald-50">Product Demo</CardTitle>
                    <CardDescription class="text-emerald-100/75">16:9 placeholder for your intro movie</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div class="aspect-video w-full rounded-lg border border-dashed border-emerald-200/40 bg-black/40 p-4">
                      <div class="flex h-full w-full items-center justify-center rounded-md bg-black/70 text-white">
                        <div class="text-center">
                          <div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-xl">
                            ▶
                          </div>
                          <p class="text-sm font-medium">Movie placeholder (16:9)</p>
                          <p class="mt-1 text-xs text-white/70">Replace with an embedded video or preview later.</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>

            <section id="quickstart" class="mt-14 grid gap-4 sm:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle class="font-headline text-base">1. Install</CardTitle>
                  <CardDescription>Install touchgrass CLI.</CardDescription>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                  <code class="rounded bg-muted px-2 py-1">
                    curl -fsSL https://raw.githubusercontent.com/tomtev/touchgrass/main/install.sh | bash
                  </code>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle class="font-headline text-base">2. Connect</CardTitle>
                  <CardDescription>Configure Telegram and pair your user.</CardDescription>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                  <code class="rounded bg-muted px-2 py-1">tg setup</code>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle class="font-headline text-base">3. Launch</CardTitle>
                  <CardDescription>Start a remote-controlled session.</CardDescription>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                  <code class="rounded bg-muted px-2 py-1">tg claude</code>
                </CardContent>
              </Card>
            </section>
          </div>
        </main>
        <script>{raw(grassScript)}</script>
      </body>
    </html>
  );
});

app.get("/health", (c) => c.json({ ok: true }));

export default app;
