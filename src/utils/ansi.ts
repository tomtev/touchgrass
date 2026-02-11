import { escapeHtml } from "../channels/telegram/formatter";

// Strip ANSI escape sequences from text
// Covers: colors, cursor movement, erase, OSC, etc.
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\))/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

// Re-export for backward compat
export { escapeHtml } from "../channels/telegram/formatter";
export { chunkText } from "../channels/telegram/formatter";

// Convert markdown to Telegram HTML
// Handles: bold, italic, code, code blocks, links
export function markdownToHtml(text: string): string {
  // First, extract code blocks and inline code to protect them
  const codeBlocks: string[] = [];
  // Fenced code blocks: ```lang\n...\n```
  let result = text.replace(/```[\w]*\n([\s\S]*?)```/g, (_match: string, code: string) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHtml(code.trimEnd())}</pre>`);
    return `\x00CB${idx}\x00`;
  });
  // Inline code: `...`
  result = result.replace(/`([^`]+)`/g, (_match: string, code: string) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00CB${idx}\x00`;
  });

  // Escape HTML in the remaining text
  result = escapeHtml(result);

  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/__(.+?)__/g, "<b>$1</b>");
  // Italic: *text* or _text_ (but not inside words with underscores)
  result = result.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<i>$1</i>");
  result = result.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<i>$1</i>");
  // Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Restore code blocks
  result = result.replace(/\x00CB(\d+)\x00/g, (_match: string, idx: string) => codeBlocks[parseInt(idx)]);

  return result;
}
