import { describe, expect, it } from "vitest";
import { errorPageCopy } from "./error-page-copy";

describe("errorPageCopy", () => {
  it("has the S23 title for each status", () => {
    expect(errorPageCopy[404].title).toBe("Halaman tidak ditemukan");
    expect(errorPageCopy[403].title).toBe("Anda tidak punya akses ke halaman ini");
    expect(errorPageCopy[500].title).toBe("Terjadi kesalahan di sisi kami");
  });

  it("never mentions internal details on the 500 page", () => {
    const text = JSON.stringify(errorPageCopy[500]).toLowerCase();
    for (const word of ["stack", "prisma", "sql", "undefined", "error:"]) {
      expect(text).not.toContain(word);
    }
  });
});
