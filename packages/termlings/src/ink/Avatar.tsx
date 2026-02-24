import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Text, Box } from 'ink';
import { decodeDNA, generateGrid, hslToRgb, traitsFromName } from '../index.js';
import type { Pixel } from '../index.js';

export interface AvatarProps {
  dna?: string;
  name?: string;
  compact?: boolean;
  walking?: boolean;
  talking?: boolean;
  waving?: boolean;
}

export function Avatar({ dna, name, compact = false, walking = false, talking = false, waving = false }: AvatarProps) {
  const [walkFrame, setWalkFrame] = useState(0);
  const [talkFrame, setTalkFrame] = useState(0);
  const [waveFrame, setWaveFrame] = useState(0);

  useEffect(() => {
    if (!walking) { setWalkFrame(0); return; }
    const id = setInterval(() => setWalkFrame(f => (f + 1) % 6), 400);
    return () => clearInterval(id);
  }, [walking]);

  useEffect(() => {
    if (!talking) { setTalkFrame(0); return; }
    let timeout: ReturnType<typeof setTimeout>;
    function tick() {
      setTalkFrame(f => (f + 1) % 2);
      timeout = setTimeout(tick, 100 + Math.random() * 200);
    }
    timeout = setTimeout(tick, 100 + Math.random() * 200);
    return () => clearTimeout(timeout);
  }, [talking]);

  useEffect(() => {
    if (!waving) { setWaveFrame(0); return; }
    setWaveFrame(1);
    const id = setInterval(() => setWaveFrame(f => f === 1 ? 2 : 1), 600);
    return () => clearInterval(id);
  }, [waving]);

  const traits = useMemo(
    () => dna ? decodeDNA(dna) : traitsFromName(name ?? 'agent'),
    [dna, name]
  );
  const grid = useMemo(
    () => generateGrid(traits, walkFrame, talkFrame, waveFrame),
    [traits, walkFrame, talkFrame, waveFrame]
  );

  const faceHueDeg = traits.faceHue * 30;
  const hatHueDeg = traits.hatHue * 30;
  const faceRgb = hslToRgb(faceHueDeg, 0.5, 0.5);
  const darkRgb = hslToRgb(faceHueDeg, 0.5, 0.28);
  const hatRgb = hslToRgb(hatHueDeg, 0.5, 0.5);

  const faceHex = rgbHex(faceRgb);
  const darkHex = rgbHex(darkRgb);
  const hatHex = rgbHex(hatRgb);

  if (compact) {
    // Half-block rendering: two rows per line using ▀/▄
    const lines: React.ReactNode[] = [];
    for (let r = 0; r < grid.length; r += 2) {
      const topRow = grid[r];
      const botRow = r + 1 < grid.length ? grid[r + 1] : null;
      const spans: React.ReactNode[] = [];
      for (let c = 0; c < topRow.length; c++) {
        const top = cellHex(topRow[c], faceHex, darkHex, hatHex);
        const bot = botRow ? cellHex(botRow[c], faceHex, darkHex, hatHex) : null;
        if (top && bot) {
          spans.push(<Text key={c} color={top} backgroundColor={bot}>▀</Text>);
        } else if (top) {
          spans.push(<Text key={c} color={top}>▀</Text>);
        } else if (bot) {
          spans.push(<Text key={c} color={bot}>▄</Text>);
        } else {
          spans.push(<Text key={c}> </Text>);
        }
      }
      lines.push(<Box key={r}>{spans}</Box>);
    }
    return <Box flexDirection="column">{lines}</Box>;
  }

  // Full-size rendering: ██ per pixel
  return (
    <Box flexDirection="column">
      {grid.map((row, y) => (
        <Box key={y}>
          {row.map((cell, x) => {
            const ch = cellChar(cell, faceHex, darkHex, hatHex);
            return ch;
          }).map((node, x) => <React.Fragment key={x}>{node}</React.Fragment>)}
        </Box>
      ))}
    </Box>
  );
}

function rgbHex(rgb: [number, number, number]): string {
  return `#${rgb[0].toString(16).padStart(2, '0')}${rgb[1].toString(16).padStart(2, '0')}${rgb[2].toString(16).padStart(2, '0')}`;
}

function cellHex(cell: Pixel, face: string, dark: string, hat: string): string | null {
  if (cell === 'f' || cell === 'l' || cell === 'a' || cell === 'q' || cell === 'r' || cell === 'm') return face;
  if (cell === 'e' || cell === 's' || cell === 'n' || cell === 'd') return dark;
  if (cell === 'h' || cell === 'k') return hat;
  return null;
}

function cellChar(cell: Pixel, face: string, dark: string, hat: string): React.ReactNode {
  switch (cell) {
    case 'f': return <Text color={face}>██</Text>;
    case 'e': case 'd': return <Text color={dark}>██</Text>;
    case 'h': return <Text color={hat}>██</Text>;
    case 'k': return <Text color={hat}>▐▌</Text>;
    case 'l': return <Text color={face}>▌ </Text>;
    case 'a': return <Text color={face}>▄▄</Text>;
    case 's': return <Text color={dark} backgroundColor={face}>▄▄</Text>;
    case 'n': return <Text color={dark} backgroundColor={face}>▐▌</Text>;
    case 'm': return <Text color={dark} backgroundColor={face}>▀▀</Text>;
    case 'q': return <Text color={dark} backgroundColor={face}> ▗</Text>;
    case 'r': return <Text color={dark} backgroundColor={face}>▖ </Text>;
    default: return <Text>  </Text>;
  }
}
