import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("install.sh daemon restart", () => {
  it("keeps an active daemon alive during upgrade", async () => {
    const root = mkdtempSync(join(tmpdir(), "tg-install-test-"));
    const homeDir = join(root, "home");
    const installDir = join(root, "bin");
    const mockBinDir = join(root, "mock-bin");

    mkdirSync(join(homeDir, ".touchgrass"), { recursive: true });
    mkdirSync(installDir, { recursive: true });
    mkdirSync(mockBinDir, { recursive: true });

    const oldDaemon = Bun.spawn(["sleep", "30"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    const oldDaemonPid = oldDaemon.pid;
    writeFileSync(join(homeDir, ".touchgrass", "daemon.pid"), `${oldDaemonPid}\n`);

    writeFileSync(
      join(mockBinDir, "curl"),
      `#!/bin/sh
set -eu
for arg in "$@"; do
  case "$arg" in
    *api.github.com/repos/*/releases/latest*)
      echo '{"tag_name":"v9.9.9"}'
      exit 0
      ;;
  esac
done
out=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
if [ -z "$out" ]; then
  echo "missing -o target" >&2
  exit 1
fi
cat > "$out" <<'EOF'
#!/bin/sh
set -eu
if [ "\${1:-}" = "ls" ]; then
  # Compatibility check only; do not restart daemon in this mock.
  exit 0
fi
exit 0
EOF
printf "200"
`,
      { mode: 0o755 }
    );

    try {
      const proc = Bun.spawn(["bash", "install.sh"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: homeDir,
          TG_INSTALL_DIR: installDir,
          PATH: `${mockBinDir}:${process.env.PATH ?? ""}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain(`Daemon kept alive (${oldDaemonPid})`);
      expect(stdout).not.toContain("Stopped old daemon");
      expect(stdout).not.toContain("Daemon restarted");
      expect(isPidAlive(oldDaemonPid)).toBe(true);

      const daemonPidPath = join(homeDir, ".touchgrass", "daemon.pid");
      const daemonPid = parseInt(readFileSync(daemonPidPath, "utf-8").trim(), 10);
      expect(Number.isFinite(daemonPid)).toBe(true);
      expect(daemonPid).toBe(oldDaemonPid);
      expect(isPidAlive(daemonPid)).toBe(true);
    } finally {
      if (isPidAlive(oldDaemonPid)) {
        try {
          process.kill(oldDaemonPid, "SIGTERM");
        } catch {}
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
});
