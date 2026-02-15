import { describe, expect, it } from "bun:test";
import { __filePickerTestUtils } from "../bot/handlers/files";

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

describe("web app selection payload parsing", () => {
  it("parses raw JSON payload", () => {
    const parsed = __filePickerTestUtils.parseWebAppSelectionPayload(
      JSON.stringify({ kind: "tg_files_pick", token: "abc", file: "src/app.ts" })
    );
    expect(parsed).toEqual({ kind: "tg_files_pick", token: "abc", file: "src/app.ts" });
  });

  it("parses base64url encoded payload", () => {
    const raw = Buffer.from(
      JSON.stringify({ kind: "tg_files_pick", token: "def", file: "./README.md" }),
      "utf8"
    ).toString("base64url");
    const parsed = __filePickerTestUtils.parseWebAppSelectionPayload(raw);
    expect(parsed).toEqual({ kind: "tg_files_pick", token: "def", file: "README.md" });
  });
});
