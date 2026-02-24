import { useState, useEffect, useMemo, useRef } from 'react';
import { decodeDNA, generateGrid, traitsFromName } from '../index.js';
import type { Pixel } from '../index.js';

export interface AvatarProps {
  dna?: string;
  name?: string;
  size?: 'sm' | 'lg' | 'xl';
  walking?: boolean;
  talking?: boolean;
  waving?: boolean;
}

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'tg-avatar-styles';
  style.textContent = `
    @keyframes tg-avatar-idle-bob {
      0%, 30%, 100% { transform: translateY(0); }
      35%, 65% { transform: translateY(1px); }
    }
  `;
  document.head.appendChild(style);
}

const PX_SIZES = { sm: 3, lg: 8, xl: 14 } as const;

export function Avatar({ dna, name, size = 'lg', walking = false, talking = false, waving = false }: AvatarProps) {
  const [walkFrame, setWalkFrame] = useState(0);
  const [talkFrame, setTalkFrame] = useState(0);
  const [waveFrame, setWaveFrame] = useState(0);
  const [visible, setVisible] = useState(false);
  const idleDelay = useRef(Math.random() * 3);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => injectStyles(), []);

  // IntersectionObserver — only animate when visible
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '100px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!walking || !visible) { setWalkFrame(0); return; }
    const id = setInterval(() => setWalkFrame(f => (f + 1) % 6), 400);
    return () => clearInterval(id);
  }, [walking, visible]);

  useEffect(() => {
    if (!talking || !visible) { setTalkFrame(0); return; }
    let timeout: ReturnType<typeof setTimeout>;
    function tick() {
      setTalkFrame(f => (f + 1) % 2);
      timeout = setTimeout(tick, 100 + Math.random() * 200);
    }
    timeout = setTimeout(tick, 100 + Math.random() * 200);
    return () => clearTimeout(timeout);
  }, [talking, visible]);

  useEffect(() => {
    if (!waving || !visible) { setWaveFrame(0); return; }
    setWaveFrame(1);
    const id = setInterval(() => setWaveFrame(f => f === 1 ? 2 : 1), 600);
    return () => clearInterval(id);
  }, [waving, visible]);

  const traits = useMemo(
    () => dna ? decodeDNA(dna) : traitsFromName(name ?? 'agent'),
    [dna, name]
  );
  const grid = useMemo(
    () => generateGrid(traits, walkFrame, talkFrame, waveFrame),
    [traits, walkFrame, talkFrame, waveFrame]
  );

  const hue = traits.faceHue * 30;
  const hatHueDeg = traits.hatHue * 30;
  const faceColor = `hsl(${hue}, 50%, 50%)`;
  const darkColor = `hsl(${hue}, 50%, 28%)`;
  const hatColor = `hsl(${hatHueDeg}, 50%, 50%)`;

  const pxSize = PX_SIZES[size];
  const rows = grid.length;
  const smScale = 27 / Math.max(9 * PX_SIZES.sm, rows * PX_SIZES.sm);
  const isIdle = !walking && !talking;
  const totalCells = rows * 9;
  const cellSize = size === 'sm' ? pxSize + 1 : pxSize;

  function pixelBg(type: Pixel): string {
    if (type === 'e' || type === 'd') return darkColor;
    if (type === 'f' || type === 'q' || type === 'r') return faceColor;
    if (type === 'h' || type === 'k') return hatColor;
    if (type === 'm' || type === 's' || type === 'n') return faceColor;
    return 'transparent';
  }

  const needsOverlay = (c: Pixel) =>
    c === 's' || c === 'n' || c === 'm' || c === 'q' || c === 'r' || c === 'l' || c === 'a';

  const overlayStyle = (cell: Pixel): React.CSSProperties | undefined => {
    const base: React.CSSProperties = { position: 'absolute', background: darkColor };
    switch (cell) {
      case 's': return { ...base, bottom: 0, left: 0, width: '100%', height: '50%' };
      case 'n': return { ...base, top: 0, left: '25%', width: '50%', height: '100%' };
      case 'm': return { ...base, top: 0, left: 0, width: '100%', height: '50%' };
      case 'q': return { ...base, bottom: 0, right: 0, width: '50%', height: '50%' };
      case 'r': return { ...base, bottom: 0, left: 0, width: '50%', height: '50%' };
      case 'l': return { ...base, background: faceColor, top: 0, left: 0, width: '50%', height: '100%' };
      case 'a': return { ...base, background: faceColor, bottom: 0, left: 0, width: '100%', height: '50%' };
      default: return undefined;
    }
  };

  let flatIndex = 0;

  return (
    <div
      ref={containerRef}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...(size === 'sm' ? { width: 27, height: 27, overflow: 'hidden' } : {}),
      }}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(9, ${pxSize}px)`,
        gridAutoRows: `${pxSize}px`,
        userSelect: 'none',
        transformOrigin: 'center',
        transform: size === 'sm' && smScale < 1 ? `scale(${smScale})` : undefined,
      }}>
        {grid.map((row, y) =>
          row.map((cell, x) => {
            const idx = flatIndex++;
            const animate = isIdle && idx < totalCells - 9;
            return (
              <span
                key={`${y}-${x}`}
                style={{
                  width: cellSize,
                  height: cellSize,
                  display: 'block',
                  background: pixelBg(cell),
                  ...(needsOverlay(cell) ? { position: 'relative' as const, overflow: 'hidden' as const } : {}),
                  ...(animate ? {
                    animation: 'tg-avatar-idle-bob 3s steps(1) infinite',
                    animationDelay: `${idleDelay.current}s`,
                  } : {}),
                }}
              >
                {needsOverlay(cell) && <span style={overlayStyle(cell)} />}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}
