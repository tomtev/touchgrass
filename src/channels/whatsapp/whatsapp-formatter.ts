import type { Formatter } from "../../channel/formatter";

export class WhatsAppFormatter implements Formatter {
  bold(text: string): string {
    return `*${text}*`;
  }

  italic(text: string): string {
    return `_${text}_`;
  }

  code(text: string): string {
    return `\`${text}\``;
  }

  pre(text: string): string {
    return `\`\`\`${text}\`\`\``;
  }

  link(text: string, url: string): string {
    return `${text}: ${url}`;
  }

  escape(text: string): string {
    // WhatsApp formatting is markdown-like. Keep escaping minimal.
    return text.replace(/[`*_~]/g, "\\$&");
  }

  fromMarkdown(text: string): string {
    // WhatsApp already supports lightweight markdown-like formatting.
    return text;
  }
}
