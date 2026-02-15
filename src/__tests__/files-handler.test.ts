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
});
