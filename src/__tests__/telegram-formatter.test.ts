import { describe, expect, it } from "bun:test";
import { TelegramFormatter } from "../channels/telegram/telegram-formatter";

describe("TelegramFormatter", () => {
  it("escapes html in code()", () => {
    const fmt = new TelegramFormatter();
    expect(fmt.code("/start <claude|codex|pi> [project-name]")).toBe(
      "<code>/start &lt;claude|codex|pi&gt; [project-name]</code>"
    );
  });
});

