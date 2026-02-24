import { useMemo, useRef } from 'react';
import { encodeDNA, traitsFromName, renderLayeredSVG, getAvatarCSS } from '../index.js';

export interface AvatarProps {
  dna?: string;
  name?: string;
  size?: 'sm' | 'lg' | 'xl';
  walking?: boolean;
  talking?: boolean;
  waving?: boolean;
}

let cssInjected = false;

function injectCSS() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const style = document.createElement('style');
  style.id = 'tg-avatar-css';
  style.textContent = getAvatarCSS();
  document.head.appendChild(style);
}

const PX_SIZES = { sm: 3, lg: 8, xl: 14 } as const;

export function Avatar({ dna, name, size = 'lg', walking = false, talking = false, waving = false }: AvatarProps) {
  injectCSS();
  const idleDelay = useRef(Math.random() * 3);
  const resolvedDna = useMemo(() => dna ?? encodeDNA(traitsFromName(name ?? 'agent')), [dna, name]);
  const { svg, legFrames } = useMemo(() => renderLayeredSVG(resolvedDna, PX_SIZES[size]), [resolvedDna, size]);
  const idle = !walking && !talking && !waving;

  const cls = [
    'tg-avatar',
    idle && 'idle',
    walking && 'walking',
    talking && 'talking',
    waving && 'waving',
    legFrames === 3 && 'walk-3f',
    legFrames === 4 && 'walk-4f',
    size === 'sm' && 'tg-avatar-sm',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cls}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        '--tg-idle-delay': `${idleDelay.current}s`,
        ...(size === 'sm' ? { width: 27, height: 27, overflow: 'hidden' } : {}),
      } as React.CSSProperties}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
