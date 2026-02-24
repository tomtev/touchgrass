// Strip ANSI escape sequences from text
// Covers: colors, cursor movement, erase, OSC, etc.
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

// Replace ANSI codes with spaces (preserves word boundaries from TUI cursor positioning)
// then collapse whitespace. Useful for extracting readable text from TUI output.
export function stripAnsiReadable(text: string): string {
  return text.replace(ANSI_RE, " ").replace(/\s+/g, " ");
}
