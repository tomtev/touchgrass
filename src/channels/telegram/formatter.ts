// Escape HTML special characters for Telegram HTML parse mode
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Telegram messages have a 4096 character limit
const TELEGRAM_MAX_LENGTH = 4096;
// Leave room for <pre></pre> tags and some margin
const CHUNK_MAX = TELEGRAM_MAX_LENGTH - 20;

export function chunkText(text: string, maxLen = CHUNK_MAX): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + maxLen, text.length);
    // Try to break at a newline
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > i) end = lastNewline + 1;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}
