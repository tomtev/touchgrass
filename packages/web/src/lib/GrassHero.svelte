<script>
  import { onMount } from 'svelte';

  let { children } = $props();

  let stage;
  let skyEl;
  let cloudEl;
  let sunEl;
  let grassEl;

  onMount(() => {
    if (!stage || !skyEl || !cloudEl || !sunEl || !grassEl) return;

    const SKY_CHARS = [' ', ' ', ' ', '.', "'", ':'];
    const CLOUD_CHARS = ['.', 'o', '~'];
    const GRASS_CHARS = ["'", ',', ';', ':', '.', '^'];
    const TOUCHED_CHARS = [' ', '.', '_'];
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
    let stars = [];

    const rand = (arr) => arr[(Math.random() * arr.length) | 0];
    const indexOf = (r, c) => r * cols + c;
    const inBounds = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols;

    function measureCell() {
      const probe = document.createElement('span');
      probe.textContent = '0000000000';
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      probe.style.pointerEvents = 'none';
      grassEl.appendChild(probe);
      const rect = probe.getBoundingClientRect();
      grassEl.removeChild(probe);

      const computed = getComputedStyle(grassEl);
      const measuredWidth = rect.width > 0 ? rect.width / 10 : 8;
      const measuredHeight = Number.parseFloat(computed.lineHeight || '0') || 12;
      cellWidth = Math.max(4, measuredWidth);
      cellHeight = Math.max(8, measuredHeight);
    }

    function createBuffer(fill = ' ') {
      return new Array(rows * cols).fill(fill);
    }

    function renderTo(el, buffer) {
      const lines = new Array(rows);
      for (let r = 0; r < rows; r += 1) {
        let line = '';
        const start = r * cols;
        for (let c = 0; c < cols; c += 1) line += buffer[start + c];
        lines[r] = line;
      }
      el.textContent = lines.join('\n');
    }

    function baseGrassChar(row) {
      const y = row / Math.max(1, rows - 1);
      if (y < 0.42) return ' ';
      if (y < 0.58) return Math.random() < 0.11 ? rand(['.', ':']) : ' ';
      if (y < 0.72) return Math.random() < 0.38 ? rand(['.', ':', ';']) : ' ';
      return rand(GRASS_CHARS);
    }

    function buildSky() {
      skyCells = createBuffer(' ');
      const horizon = Math.floor(rows * 0.63);
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const idx = indexOf(r, c);
          if (r < horizon) {
            const density = 0.03 + (r / Math.max(1, horizon)) * 0.02;
            skyCells[idx] = Math.random() < density ? rand(SKY_CHARS) : ' ';
          } else {
            const density = 0.06 + ((r - horizon) / Math.max(1, rows - horizon)) * 0.08;
            skyCells[idx] = Math.random() < density ? rand(['.', ':', '\u00b7']) : ' ';
          }
        }
      }
    }

    function buildSun() {
      sunCells = createBuffer(' ');
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
          if (d < radius * 0.45) sunCells[idx] = '@';
          else if (d < radius * 0.8) sunCells[idx] = 'O';
          else if (d < radius * 1.05) sunCells[idx] = 'o';
          else if (d < radius * 1.4 && Math.random() < 0.35) sunCells[idx] = '.';
        }
      }
    }

    function buildGrass() {
      grassCells = createBuffer(' ');
      decay = new Uint8Array(rows * cols);
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          grassCells[indexOf(r, c)] = baseGrassChar(r);
        }
      }
    }

    function buildCloudFrame(frame) {
      const clouds = createBuffer(' ');
      const bands = [
        { y: 0.12, phase: 0.5, speed: 0.65, threshold: 1.05 },
        { y: 0.2, phase: 1.2, speed: 0.52, threshold: 1.0 },
        { y: 0.3, phase: 2.1, speed: 0.44, threshold: 1.12 }
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
              clouds[indexOf(r, c)] = dy === 0 ? rand(CLOUD_CHARS) : '.';
            }
          }
        }
      }

      renderTo(cloudEl, clouds);
    }

    function twinkleSky() {
      const maxRow = Math.max(1, Math.floor(rows * 0.45));

      for (const s of stars) {
        skyCells[s.idx] = s.fade;
      }
      stars = [];

      const count = Math.max(2, Math.floor(cols * 0.008));
      for (let i = 0; i < count; i += 1) {
        const r = Math.floor(Math.random() * maxRow);
        const c = Math.floor(Math.random() * cols);
        const idx = indexOf(r, c);
        const prev = skyCells[idx];
        skyCells[idx] = rand(['*', '+', '*']);
        stars.push({ idx, fade: Math.random() < 0.5 ? rand(['.', "'"]) : prev });
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

    const interval = setInterval(() => {
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

      if (tick % 3 === 0) twinkleSky();
    }, 90);

    stage.addEventListener('pointermove', queuePointer, { passive: true });
    stage.addEventListener('pointerdown', queuePointer, { passive: true });
    window.addEventListener('resize', rebuild, { passive: true });

    rebuild();

    return () => {
      clearInterval(interval);
      stage.removeEventListener('pointermove', queuePointer);
      stage.removeEventListener('pointerdown', queuePointer);
      window.removeEventListener('resize', rebuild);
    };
  });
</script>

<section bind:this={stage} class="hero-stage">
  <pre bind:this={skyEl} class="hero-ascii-layer hero-ascii-sky"></pre>
  <pre bind:this={cloudEl} class="hero-ascii-layer hero-ascii-clouds"></pre>
  <pre bind:this={sunEl} class="hero-ascii-layer hero-ascii-sun"></pre>
  <pre bind:this={grassEl} class="hero-ascii-layer hero-grass-layer hero-grass-fixed"></pre>

  {@render children()}
</section>
