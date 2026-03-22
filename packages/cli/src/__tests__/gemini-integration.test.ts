import { describe, it, expect } from "bun:test";
import { __cliRunTestUtils } from "../cli/run";

const { extractApprovalPrompt } = __cliRunTestUtils;

describe("gemini prompt extraction", () => {
  it("extracts 'Allow execution' prompt and options with command context", () => {
    const ptyOutput = `
╭─── Action Required ──╮
│ ? Shell git diff     │
│                      │
│ git diff             │
│ Allow execution?     │
╰──────────────────────╯
● 1. Allow once
  2. No
`;
    const result = extractApprovalPrompt("gemini", ptyOutput);
    expect(result).not.toBeNull();
    // Should skip UI lines and extract just the command
    expect(result?.promptText).toBe("git diff\n\nAllow execution?");
    expect(result?.pollOptions).toEqual([
      "Allow once",
      "No"
    ]);
  });

  it("extracts 'Approve plan' prompt", () => {
    const ptyOutput = `
Approve plan?
1. Yes
2. No
3. Edit
`;
    const result = extractApprovalPrompt("gemini", ptyOutput);
    expect(result).not.toBeNull();
    expect(result?.promptText).toBe("Approve plan?");
    expect(result?.pollOptions).toEqual(["Yes", "No", "Edit"]);
  });

  it("ignores partial 'Allow' prompts without a question mark", () => {
    const ptyOutput = "Allow exec";
    const result = extractApprovalPrompt("gemini", ptyOutput);
    expect(result).toBeNull();
  });

  it("ignores prompts where options appear before the keyword", () => {
    // This simulates old menu items lingering in the PTY buffer
    const ptyOutput = `
1. Old Option
Allow execution of: 'ls'?
`;
    const result = extractApprovalPrompt("gemini", ptyOutput);
    expect(result).toBeNull();
  });

  it("cleans up TUI artifacts from options", () => {
    const ptyOutput = `
Allow file write?
│ 1. Yes (y)
─ 2. No (n)
`;
    const result = extractApprovalPrompt("gemini", ptyOutput);
    expect(result?.pollOptions).toEqual(["Yes", "No"]);
  });
});
