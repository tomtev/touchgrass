import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  __filePickerTestUtils,
  handleInlineFileSearch,
} from "../bot/handlers/files";
import { SessionManager } from "../session/manager";
import { createDefaultConfig, defaultSettings } from "../config/schema";

describe("file picker ranking", () => {
  it("prioritizes basename startsWith over deep substring matches", () => {
    const files = [
      "src/deep/path/auth-provider.ts",
      "auth.ts",
      "src/auth/index.ts",
      "README.md",
    ];
    const ranked = __filePickerTestUtils.rankFiles(files, "auth");
    expect(ranked[0]).toBe("auth.ts");
    expect(ranked).toContain("src/auth/index.ts");
  });

  it("falls back to deterministic ordering when query is empty", () => {
    const files = [
      "src/z.ts",
      "README.md",
      "src/deep/a.ts",
      "a.ts",
    ];
    const ranked = __filePickerTestUtils.rankFiles(files, "");
    expect(ranked[0]).toBe("a.ts");
    expect(ranked[1]).toBe("README.md");
  });
});

describe("file picker page builder", () => {
  it("adds pagination and multi-select actions", () => {
    const files = [
      "a.ts",
      "b.ts",
      "c.ts",
      "d.ts",
      "e.ts",
      "f.ts",
      "g.ts",
      "h.ts",
    ];
    const page0 = __filePickerTestUtils.buildFilePickerPage(files, "a", 0, [], 5);
    expect(page0.totalPages).toBe(2);
    expect(page0.optionLabels).toContain("➡️ Next");
    expect(page0.optionLabels).toContain("❌ Cancel");
    expect(page0.optionLabels[0]).toBe("☑️ @a.ts");
    expect(page0.title).toContain("selected 0");

    const page1 = __filePickerTestUtils.buildFilePickerPage(files, "a", 1, ["@h.ts"], 5);
    expect(page1.optionLabels).toContain("⬅️ Prev");
    expect(page1.optionLabels).toContain("🧹 Clear selected");
    expect(page1.optionLabels).toContain("❌ Cancel");
    expect(page1.optionLabels).toContain("✅ @h.ts");
    expect(page1.title).toContain("selected 1");
  });

  it("renders folders with trailing slash and folder icon", () => {
    const paths = [
      "src/",
      "src/main.ts",
      "README.md",
    ];
    const page = __filePickerTestUtils.buildFilePickerPage(paths, "src", 0, ["@src/"], 5);
    expect(page.optionLabels).toContain("✅ 📁 @src/");
    expect(page.optionLabels).toContain("☑️ @src/main.ts");
    expect(page.title).toContain("Pick paths");
  });
});

describe("inline file search shorthand", () => {
  it("parses @?query and @?query - prompt forms", () => {
    expect(__filePickerTestUtils.parseInlineFileSearch("@?readme")).toEqual({
      query: "readme",
      prompt: null,
    });
    expect(__filePickerTestUtils.parseInlineFileSearch("@?readme - summarize this")).toEqual({
      query: "readme",
      prompt: "summarize this",
    });
    expect(__filePickerTestUtils.parseInlineFileSearch("hello")).toBeNull();
  });

  it("queues '@path - prompt' using top fuzzy match", async () => {
    const root = mkdtempSync(join(tmpdir(), "tg-inline-files-"));
    try {
      writeFileSync(join(root, "README.md"), "# Touchgrass");
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "main.ts"), "console.log('ok');");

      const config = createDefaultConfig();
      const sessionManager = new SessionManager(defaultSettings);
      const remote = sessionManager.registerRemote(
        "codex",
        "telegram:100",
        "telegram:1",
        root,
        "r-inline01"
      );
      sessionManager.attach("telegram:100", remote.id);

      const sent: string[] = [];
      const ctx = {
        config,
        sessionManager,
        channel: {
          fmt: {
            code: (v: string) => v,
            escape: (v: string) => v,
          },
          send: async (_chatId: string, text: string) => {
            sent.push(text);
          },
        },
      } as any;

      const handled = await handleInlineFileSearch(
        {
          userId: "telegram:1",
          chatId: "telegram:100",
          text: "@?readme - summarize",
        },
        "@?readme - summarize",
        ctx
      );

      expect(handled).toBe(true);
      expect(remote.inputQueue[0]).toBe("@README.md - summarize");
      expect(sent[0]).toContain("@README.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("opens file picker for '@?query'", async () => {
    const root = mkdtempSync(join(tmpdir(), "tg-inline-picker-"));
    try {
      writeFileSync(join(root, "README.md"), "# Touchgrass");
      writeFileSync(join(root, "package.json"), "{}");

      const config = createDefaultConfig();
      const sessionManager = new SessionManager(defaultSettings);
      const remote = sessionManager.registerRemote(
        "claude",
        "telegram:100",
        "telegram:1",
        root,
        "r-inline02"
      );
      sessionManager.attach("telegram:100", remote.id);

      const ctx = {
        config,
        sessionManager,
        channel: {
          fmt: {
            bold: (v: string) => v,
            code: (v: string) => v,
            escape: (v: string) => v,
          },
          send: async () => {
            return "msg";
          },
          sendPoll: async () => {
            return { pollId: "poll-inline", messageId: "message-inline" };
          },
        },
      } as any;

      const handled = await handleInlineFileSearch(
        {
          userId: "telegram:1",
          chatId: "telegram:100",
          text: "@?readme",
        },
        "@?readme",
        ctx
      );

      expect(handled).toBe(true);
      expect(sessionManager.getFilePickerByPollId("poll-inline")).toBeTruthy();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
