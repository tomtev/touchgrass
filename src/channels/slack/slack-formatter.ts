import type { Formatter } from "../../channel/formatter";

function escapeMrkdwn(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export class SlackFormatter implements Formatter {
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
    return `<${url}|${text}>`;
  }

  escape(text: string): string {
    return escapeMrkdwn(text);
  }

  fromMarkdown(text: string): string {
    return text;
  }
}

