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
