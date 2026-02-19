import type { Context } from "hono";
import { Hono } from "hono";
import { raw } from "hono/html";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Bindings = {
  ASSETS: Fetcher;
};

type Env = {
  Bindings: Bindings;
};

const app = new Hono<Env>();

const emojiFavicon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ctext y='50' font-size='50'%3E%E2%9B%B3%EF%B8%8F%3C/text%3E%3C/svg%3E";
const installCommand = "curl -fsSL https://touchgrass.sh/install.sh | bash";
const siteUrl = "https://touchgrass.sh";
const pageTitle = "touchgrass.sh | Run AI coding agents from your phone";
const pageDescription =
  "Bridge Claude Code, Codex, Kimi, and Pi to Telegram. Send prompts, approve tools, attach files, and build personal agents — all from your phone.";
const ogImageUrl = `${siteUrl}/og.png`;
const seoSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "touchgrass.sh",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux, Windows",
  description: pageDescription,
  url: siteUrl,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

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

const installCopyScript = String.raw`(() => {
  const copyButton = document.getElementById("copy-install-command");
  if (!copyButton) return;
  const command = copyButton.getAttribute("data-command") || "";
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(command);
      const original = copyButton.textContent;
      copyButton.textContent = "Copied";
      setTimeout(() => {
        copyButton.textContent = original || "Copy";
      }, 1300);
    } catch {
      copyButton.textContent = "Failed";
      setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1300);
    }
  });
})();`;

async function serveAsset(c: Context<Env>, pathname: string) {
  const assetUrl = new URL(c.req.url);
  assetUrl.pathname = pathname;
  return c.env.ASSETS.fetch(new Request(assetUrl.toString(), c.req.raw));
}

app.get("/styles.css", (c) => serveAsset(c, "/styles.css"));
app.get("/install.sh", (c) => serveAsset(c, "/install.sh"));
app.get("/install.ps1", (c) => serveAsset(c, "/install.ps1"));
app.get("/og.png", (c) => serveAsset(c, "/og.png"));
app.get("/robots.txt", (c) => serveAsset(c, "/robots.txt"));
app.get("/sitemap.xml", (c) => serveAsset(c, "/sitemap.xml"));

app.get("/", (c) => {
  return c.html(
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
        <meta
          name="keywords"
          content="touchgrass, telegram bot, claude code, codex, kimi, pi, remote terminal, ai cli controller"
        />
        <meta name="author" content="touchgrass.sh" />
        <meta name="theme-color" content="#04090a" />

        <link rel="canonical" href={siteUrl} />
        <link rel="icon" href={emojiFavicon} />

        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="touchgrass.sh" />
        <meta property="og:url" content={siteUrl} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:image" content={ogImageUrl} />
        <meta property="og:image:alt" content="touchgrass terminal bridge hero preview" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
        <meta name="twitter:image" content={ogImageUrl} />

        <link rel="stylesheet" href="/styles.css" />
        <script type="application/ld+json">{raw(JSON.stringify(seoSchema))}</script>
      </head>
      <body>
        <main class="min-h-screen bg-[#d9e4df]">
          <section
            id="hero-grass-stage"
            class="hero-ascii-stage relative min-h-screen w-screen overflow-hidden border-y border-emerald-900/35 text-emerald-200"
          >
            <pre id="ascii-sky" class="hero-ascii-layer hero-ascii-sky px-0 py-4 text-[12px] leading-[12px]"></pre>
            <pre id="ascii-clouds" class="hero-ascii-layer hero-ascii-clouds px-0 py-4 text-[12px] leading-[12px]"></pre>
            <pre id="ascii-sun" class="hero-ascii-layer hero-ascii-sun px-0 py-4 text-[12px] leading-[12px]"></pre>
            <pre
              id="grass-grid"
              class="hero-ascii-layer hero-grass-layer hero-grass-fixed px-0 py-4 text-[12px] leading-[12px]"
            ></pre>

            <div class="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-8 lg:px-8">
              <div class="flex flex-1 flex-col justify-center gap-6">
                <Card class="overflow-hidden border-emerald-200/30 bg-black/50 backdrop-blur">
                  <CardHeader class="gap-4 pb-3">
                    <div class="flex items-center gap-3">
                      <span class="text-2xl" aria-hidden="true">⛳️</span>
                      <p class="font-headline text-sm tracking-wide text-emerald-100/95">touchgrass.sh</p>
                    </div>
                    <CardTitle class="font-headline text-4xl leading-tight tracking-tight text-balance text-white sm:text-5xl">
                      Run your AI coding agents from your phone
                    </CardTitle>
                    <p class="max-w-6xl text-lg text-emerald-100/90">
                      Bridge Claude Code, Codex, Kimi, and Pi to Telegram. Send prompts, approve tools, attach files, and manage long-running sessions — all from chat.
                    </p>
                  </CardHeader>
                </Card>

                <div class="pb-2">
                  <div class="flex w-full flex-wrap items-center gap-2 rounded-lg border border-emerald-200/30 bg-black/55 p-2 sm:flex-nowrap">
                    <span class="shrink-0 px-2 text-sm font-semibold tracking-wide text-emerald-100/90">
                      INSTALL:
                    </span>
                    <code class="flex-1 rounded-md border border-emerald-200/30 bg-black/55 px-3 py-2 text-sm text-emerald-100">
                      {installCommand}
                    </code>
                    <button
                      id="copy-install-command"
                      data-command={installCommand}
                      type="button"
                      class="inline-flex h-10 items-center justify-center rounded-md border border-emerald-200/50 bg-white/5 px-4 py-2 text-sm font-medium text-emerald-50 transition-colors hover:bg-white/15"
                    >
                      Copy
                    </button>
                    <a
                      href="https://github.com/tomtev/touchgrass"
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open touchgrass on GitHub"
                      class="inline-flex h-10 w-10 items-center justify-center rounded-md border border-emerald-200/50 bg-white/5 text-emerald-50 transition-colors hover:bg-white/15"
                    >
                      <svg class="h-5 w-5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.5c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.82 1.23.82.72 1.21 1.87.86 2.33.66.07-.52.28-.86.51-1.06-1.78-.2-3.65-.89-3.65-3.97 0-.88.31-1.6.82-2.17-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.64 7.64 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.57.82 1.29.82 2.17 0 3.09-1.88 3.76-3.67 3.96.29.25.54.74.54 1.49v2.2c0 .21.14.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                      </svg>
                    </a>
                  </div>
                </div>

                <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Card class="overflow-hidden border-emerald-200/30 bg-black/50 backdrop-blur">
                    <CardContent class="p-4">
                      <p class="font-headline text-sm text-emerald-300">Zero config</p>
                      <p class="mt-1 text-sm text-emerald-100/80">Wraps your existing CLI. Just prefix with <code class="text-emerald-200">tg</code> and you're live.</p>
                    </CardContent>
                  </Card>
                  <Card class="overflow-hidden border-emerald-200/30 bg-black/50 backdrop-blur">
                    <CardContent class="p-4">
                      <p class="font-headline text-sm text-emerald-300">Multi-tool</p>
                      <p class="mt-1 text-sm text-emerald-100/80">Claude Code, Codex, Pi, and Kimi supported out of the box.</p>
                    </CardContent>
                  </Card>
                  <Card class="overflow-hidden border-emerald-200/30 bg-black/50 backdrop-blur">
                    <CardContent class="p-4">
                      <p class="font-headline text-sm text-emerald-300">Build agents</p>
                      <p class="mt-1 text-sm text-emerald-100/80">Scaffold personal agents with workflows, skills, and updatable core.</p>
                    </CardContent>
                  </Card>
                </div>

                <Card class="overflow-hidden border-emerald-200/30 bg-black/45 backdrop-blur">
                  <CardContent class="p-2 sm:p-4">
                    <div class="w-full overflow-hidden border border-emerald-200/30 bg-black/60">
                      <video
                        class="block h-auto min-h-[20rem] w-full object-cover sm:min-h-[28rem]"
                        src="/mov.mov"
                        autoplay
                        muted
                        loop
                        playsinline
                        preload="metadata"
                      >
                        Your browser does not support HTML5 video.
                      </video>
                    </div>
                  </CardContent>
                </Card>

                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Card class="overflow-hidden border-emerald-200/30 bg-black/50 backdrop-blur">
                    <CardContent class="p-4">
                      <p class="font-headline text-sm text-emerald-300">Works from anywhere</p>
                      <p class="mt-1 text-sm text-emerald-100/80">Send prompts, approve tool calls, share files, and reply with context — all from Telegram on your phone.</p>
                    </CardContent>
                  </Card>
                  <Card class="overflow-hidden border-emerald-200/30 bg-black/50 backdrop-blur">
                    <CardContent class="p-4">
                      <p class="font-headline text-sm text-emerald-300">Lightweight</p>
                      <p class="mt-1 text-sm text-emerald-100/80">Just a PTY bridge and daemon. Auto-starts when you run a session, auto-stops when idle. No background services.</p>
                    </CardContent>
                  </Card>
                </div>

                <Card class="overflow-hidden border-emerald-200/30 bg-black/50 backdrop-blur">
                  <CardContent class="p-5">
                    <p class="font-headline text-base text-emerald-300">Get started in 60 seconds</p>
                    <pre class="mt-3 overflow-x-auto rounded-md border border-emerald-200/20 bg-black/60 p-4 text-sm leading-relaxed text-emerald-100/90"><code>{`curl -fsSL https://touchgrass.sh/install.sh | bash
tg setup          # connect your Telegram bot
tg pair           # pair from chat
tg claude         # start a bridged session`}</code></pre>
                  </CardContent>
                </Card>

                <Card class="overflow-hidden border-emerald-200/30 bg-black/50 backdrop-blur">
                  <CardContent class="p-5">
                    <p class="font-headline text-base text-emerald-300">Build a personal agent</p>
                    <p class="mt-1 text-sm text-emerald-100/80">
                      Scaffold an agent with workflows and skills. The managed core updates automatically — your customizations stay untouched.
                    </p>
                    <pre class="mt-3 overflow-x-auto rounded-md border border-emerald-200/20 bg-black/60 p-4 text-sm leading-relaxed text-emerald-100/90"><code>{`tg agent create my-agent --name "My Agent"
cd my-agent
tg claude`}</code></pre>
                  </CardContent>
                </Card>

                <a
                  href="https://github.com/tomtev/touchgrass"
                  target="_blank"
                  rel="noreferrer"
                  class="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-emerald-200/50 bg-black/80 px-4 text-base font-semibold text-emerald-50 transition-colors hover:bg-black"
                >
                  Documentation
                  <span aria-hidden="true">→</span>
                </a>
              </div>
            </div>
          </section>
        </main>
        <script>{raw(grassScript)}</script>
        <script>{raw(installCopyScript)}</script>
      </body>
    </html>
  );
});

app.get("/health", (c) => c.json({ ok: true }));

export default app;
