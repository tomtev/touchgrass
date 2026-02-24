<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { encodeDNA, traitsFromName, renderLayeredSVG, getAvatarCSS } from '../index.js';

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

let cssInjected = false;
onMounted(() => {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const style = document.createElement('style');
  style.id = 'tg-avatar-css';
  style.textContent = getAvatarCSS();
  document.head.appendChild(style);
});

const idleDelay = Math.random() * 3;

const resolvedDna = computed(() =>
  props.dna ?? encodeDNA(traitsFromName(props.name ?? 'agent'))
);
const rendered = computed(() =>
  renderLayeredSVG(resolvedDna.value, PX_SIZES[props.size])
);
const idle = computed(() => !props.walking && !props.talking && !props.waving);
</script>

<template>
  <div
    class="tg-avatar"
    :class="{
      idle: idle,
      walking: props.walking,
      talking: props.talking,
      waving: props.waving,
      'walk-3f': rendered.legFrames === 3,
      'walk-4f': rendered.legFrames === 4,
      'tg-avatar-sm': props.size === 'sm',
    }"
    :style="{ '--tg-idle-delay': `${idleDelay}s` }"
    v-html="rendered.svg"
  />
</template>

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
.tg-avatar-sm :deep(svg) {
  width: 27px;
  height: 27px;
}
</style>
