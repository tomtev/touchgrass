import { describe, expect, it } from "bun:test";
import { basename } from "path";
import { __cliAgentsTestUtils } from "../cli/agents";

const { parseAgentSource, parseAddSourceOptions, normalizeRemoteForComparison } = __cliAgentsTestUtils;

describe("tg agents add source parsing", () => {
  it("parses GitHub shorthand owner/repo", () => {
    const parsed = parseAgentSource("vercel-labs/agent-skills");
    expect(parsed?.type).toBe("git-repo");
    expect(parsed?.cloneUrl).toBe("https://github.com/vercel-labs/agent-skills.git");
    expect(parsed?.targetDirName).toBe("agent-skills");
  });

  it("parses full GitHub URL", () => {
    const parsed = parseAgentSource("https://github.com/vercel-labs/agent-skills");
    expect(parsed?.type).toBe("git-repo");
    expect(parsed?.cloneUrl).toBe("https://github.com/vercel-labs/agent-skills");
    expect(parsed?.targetDirName).toBe("agent-skills");
  });

  it("parses GitHub tree URL for a repo subpath", () => {
    const parsed = parseAgentSource(
      "https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines"
    );
    expect(parsed?.type).toBe("git-repo-subpath");
    expect(parsed?.cloneUrl).toBe("https://github.com/vercel-labs/agent-skills.git");
    expect(parsed?.branch).toBe("main");
    expect(parsed?.subpath).toBe("skills/web-design-guidelines");
    expect(parsed?.targetDirName).toBe("web-design-guidelines");
  });

  it("parses SSH git source URLs", () => {
    const parsed = parseAgentSource("git@github.com:vercel-labs/agent-skills.git");
    expect(parsed?.type).toBe("git-repo");
    expect(parsed?.cloneUrl).toBe("git@github.com:vercel-labs/agent-skills.git");
    expect(parsed?.targetDirName).toBe("agent-skills");
  });

  it("parses explicit local paths", () => {
    const parsed = parseAgentSource("./my-local-skills");
    expect(parsed?.type).toBe("local-path");
    expect(parsed?.targetDirName).toBe("my-local-skills");
    expect(basename(parsed?.localPath || "")).toBe("my-local-skills");
  });

  it("returns null for unsupported source strings", () => {
    expect(parseAgentSource("my-local-skills")).toBeNull();
    expect(parseAgentSource("agent skills")).toBeNull();
  });
});

describe("tg agents add option parsing", () => {
  it("parses dir/branch/yes options", () => {
    const parsed = parseAddSourceOptions(["--dir", "./agents/foo", "--branch", "main", "--yes"]);
    expect(parsed.targetDir).toBe("./agents/foo");
    expect(parsed.branch).toBe("main");
    expect(parsed.assumeYes).toBe(true);
    expect(parsed.explicitDir).toBe(true);
  });

  it("throws on unknown options", () => {
    expect(() => parseAddSourceOptions(["--nope"])).toThrow("Unknown option: --nope");
  });
});

describe("git remote normalization", () => {
  it("normalizes shorthand/http/ssh remote forms to the same value", () => {
    const shorthand = normalizeRemoteForComparison("vercel-labs/agent-skills");
    const https = normalizeRemoteForComparison("https://github.com/vercel-labs/agent-skills.git");
    const ssh = normalizeRemoteForComparison("git@github.com:vercel-labs/agent-skills.git");
    expect(shorthand).toBe("github.com/vercel-labs/agent-skills");
    expect(https).toBe(shorthand);
    expect(ssh).toBe(shorthand);
  });
});
