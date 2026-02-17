import { describe, expect, it } from "bun:test";
import { paths } from "../config/paths";

describe("config paths", () => {
  it("uses isolated test directory during test runtime", () => {
    expect(paths.dir.endsWith(".touchgrass-test")).toBe(true);
  });
});
