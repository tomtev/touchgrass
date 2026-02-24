/** Channel-agnostic text formatting interface.
 *  Each channel implements this for its native format
 *  (HTML for Telegram, Markdown for Discord, etc.) */
export interface Formatter {
  bold(text: string): string;
  italic(text: string): string;
  code(text: string): string; // inline monospace
  pre(text: string): string; // code block
  link(text: string, url: string): string;
  escape(text: string): string; // escape special chars for this channel
  fromMarkdown(text: string): string; // convert markdown to channel format
}
