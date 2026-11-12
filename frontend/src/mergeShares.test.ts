import { describe, expect, it } from "vitest";
import { mergeShares } from "./mergeShares";

const u = (id: number, email = `u${id}@demo.com`) => ({ id, email, name: `U${id}` });

describe("mergeShares", () => {
  it("keeps a share added locally while the initial load was in flight", () => {
    const merged = mergeShares([u(2)], [u(1), u(3)]);
    expect(merged.map((s) => s.id)).toEqual([1, 3, 2]);
  });
  it("dedupes by id", () => {
    expect(mergeShares([u(1)], [u(1)])).toHaveLength(1);
  });
  it("dedupes by email, case-insensitive", () => {
    expect(mergeShares([u(9, "Bob@Demo.com")], [u(1, "bob@demo.com")]).map((s) => s.id)).toEqual([1]);
  });
  it("handles empty sides and does not mutate inputs", () => {
    const cur = [u(2)];
    const loaded: ReturnType<typeof u>[] = [];
    expect(mergeShares(cur, loaded)).toEqual([u(2)]);
    expect(mergeShares([], [u(1)])).toEqual([u(1)]);
    expect(cur).toEqual([u(2)]);
  });
});
