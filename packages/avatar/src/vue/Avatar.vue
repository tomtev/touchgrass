<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { decodeDNA, generateGrid, traitsFromName } from '../index.js';
import type { Pixel } from '../index.js';

const props = withDefaults(defineProps<{
  dna?: string;
  name?: string;
  size?: 'sm' | 'lg' | 'xl';
  walking?: boolean;
  talking?: boolean;
  waving?: boolean;
}>(), {
  size: 'lg',
  walking: false,
  talking: false,
  waving: false,
});

const PX_SIZES = { sm: 3, lg: 8, xl: 14 } as const;

const walkFrame = ref(0);
const talkFrame = ref(0);
const waveFrame = ref(0);
const visible = ref(false);
const containerRef = ref<HTMLElement | null>(null);
const idleDelay = Math.random() * 3;

let walkInterval: ReturnType<typeof setInterval> | null = null;
let talkTimeout: ReturnType<typeof setTimeout> | null = null;
let waveInterval: ReturnType<typeof setInterval> | null = null;
let observer: IntersectionObserver | null = null;

function clearWalk() { if (walkInterval) { clearInterval(walkInterval); walkInterval = null; } }
function clearTalk() { if (talkTimeout) { clearTimeout(talkTimeout); talkTimeout = null; } }
function clearWave() { if (waveInterval) { clearInterval(waveInterval); waveInterval = null; } }

onMounted(() => {
  if (containerRef.value) {
    observer = new IntersectionObserver(
      ([entry]) => { visible.value = entry.isIntersecting; },
      { rootMargin: '100px' }
    );
    observer.observe(containerRef.value);
  }
});

onUnmounted(() => {
  clearWalk(); clearTalk(); clearWave();
  if (observer) { observer.disconnect(); observer = null; }
});

watch([() => props.walking, visible], ([w, v]) => {
  clearWalk();
  if (!w || !v) { walkFrame.value = 0; return; }
  walkInterval = setInterval(() => { walkFrame.value = (walkFrame.value + 1) % 6; }, 400);
}, { immediate: true });

watch([() => props.talking, visible], ([t, v]) => {
  clearTalk();
  if (!t || !v) { talkFrame.value = 0; return; }
  function tick() {
    talkFrame.value = (talkFrame.value + 1) % 2;
    talkTimeout = setTimeout(tick, 100 + Math.random() * 200);
  }
  talkTimeout = setTimeout(tick, 100 + Math.random() * 200);
}, { immediate: true });

watch([() => props.waving, visible], ([w, v]) => {
  clearWave();
  if (!w || !v) { waveFrame.value = 0; return; }
  waveFrame.value = 1;
  waveInterval = setInterval(() => { waveFrame.value = waveFrame.value === 1 ? 2 : 1; }, 600);
}, { immediate: true });

const traits = computed(() =>
  props.dna ? decodeDNA(props.dna) : traitsFromName(props.name ?? 'agent')
);
const grid = computed(() => generateGrid(traits.value, walkFrame.value, talkFrame.value, waveFrame.value));
const rows = computed(() => grid.value.length);

const hue = computed(() => traits.value.faceHue * 30);
const hatHueDeg = computed(() => traits.value.hatHue * 30);
const faceColor = computed(() => `hsl(${hue.value}, 50%, 50%)`);
const darkColor = computed(() => `hsl(${hue.value}, 50%, 28%)`);
const hatColor = computed(() => `hsl(${hatHueDeg.value}, 50%, 50%)`);

const pxSize = computed(() => PX_SIZES[props.size]);
const smScale = computed(() => 27 / Math.max(9 * PX_SIZES.sm, rows.value * PX_SIZES.sm));
const isIdle = computed(() => !props.walking && !props.talking);
const totalCells = computed(() => rows.value * 9);
const cellSize = computed(() => props.size === 'sm' ? pxSize.value + 1 : pxSize.value);

function pixelBg(type: Pixel): string {
  if (type === 'e' || type === 'd') return darkColor.value;
  if (type === 'f' || type === 'q' || type === 'r') return faceColor.value;
  if (type === 'h' || type === 'k') return hatColor.value;
  if (type === 'm' || type === 's' || type === 'n') return faceColor.value;
  return 'transparent';
}

function needsOverlay(c: Pixel) {
  return c === 's' || c === 'n' || c === 'm' || c === 'q' || c === 'r' || c === 'l' || c === 'a';
}

function overlayStyle(cell: Pixel): Record<string, string> {
  const base = { position: 'absolute' };
  switch (cell) {
    case 's': return { ...base, bottom: '0', left: '0', width: '100%', height: '50%', background: darkColor.value };
    case 'n': return { ...base, top: '0', left: '25%', width: '50%', height: '100%', background: darkColor.value };
    case 'm': return { ...base, top: '0', left: '0', width: '100%', height: '50%', background: darkColor.value };
    case 'q': return { ...base, bottom: '0', right: '0', width: '50%', height: '50%', background: darkColor.value };
    case 'r': return { ...base, bottom: '0', left: '0', width: '50%', height: '50%', background: darkColor.value };
    case 'l': return { ...base, top: '0', left: '0', width: '50%', height: '100%', background: faceColor.value };
    case 'a': return { ...base, bottom: '0', left: '0', width: '100%', height: '50%', background: faceColor.value };
    default: return {};
  }
}

function flatIndex(y: number, x: number) { return y * 9 + x; }
</script>

<template>
  <div
    ref="containerRef"
    class="tg-avatar"
    :class="{ 'tg-avatar-sm': size === 'sm' }"
  >
    <div
      class="tg-avatar-grid"
      :style="{
        gridTemplateColumns: `repeat(9, ${pxSize}px)`,
        gridAutoRows: `${pxSize}px`,
        transform: size === 'sm' && smScale < 1 ? `scale(${smScale})` : undefined,
      }"
    >
      <template v-for="(row, y) in grid" :key="y">
        <span
          v-for="(cell, x) in row"
          :key="`${y}-${x}`"
          :style="{
            width: `${cellSize}px`,
            height: `${cellSize}px`,
            display: 'block',
            background: pixelBg(cell),
            position: needsOverlay(cell) ? 'relative' : undefined,
            overflow: needsOverlay(cell) ? 'hidden' : undefined,
            animation: isIdle && flatIndex(y, x) < totalCells - 9
              ? `tg-avatar-idle-bob 3s steps(1) ${idleDelay}s infinite` : undefined,
          }"
        >
          <span v-if="needsOverlay(cell)" :style="overlayStyle(cell)" />
        </span>
      </template>
    </div>
  </div>
</template>

<style>
@keyframes tg-avatar-idle-bob {
  0%, 30%, 100% { transform: translateY(0); }
  35%, 65% { transform: translateY(1px); }
}
</style>

<style scoped>
.tg-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tg-avatar-sm {
  width: 27px;
  height: 27px;
  overflow: hidden;
}
.tg-avatar-grid {
  display: grid;
  user-select: none;
  transform-origin: center;
}
</style>
