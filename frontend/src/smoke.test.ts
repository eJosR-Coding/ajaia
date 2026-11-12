import { describe, expect, it } from "vitest";
import { ApiError } from "./api";

// smoke test: proves the runner + TS pipeline work, nothing fancy
describe("ApiError", () => {
  it("keeps status, code and message", () => {
    const e = new ApiError(409, "conflict", "Document changed");
    expect(e).toBeInstanceOf(Error);
    expect([e.status, e.code, e.message]).toEqual([409, "conflict", "Document changed"]);
  });
});
