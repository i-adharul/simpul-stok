import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { ApiError } from "./api-error";
import { conflictOnUnique } from "./unique-violation";

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError("boom", { code, clientVersion: "test" });

describe("conflictOnUnique", () => {
  it("returns the result when nothing fails", async () => {
    await expect(conflictOnUnique(async () => 7, "dup")).resolves.toBe(7);
  });
  it("turns P2002 into a 409 CONFLICT ApiError with the given message", async () => {
    const error = await conflictOnUnique(async () => Promise.reject(known("P2002")), "dup").catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "CONFLICT", message: "dup" });
  });
  it("lets other errors through", async () => {
    const other = known("P2025");
    await expect(conflictOnUnique(async () => Promise.reject(other), "dup")).rejects.toBe(other);
  });
});
