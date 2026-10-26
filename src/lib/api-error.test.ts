import { describe, expect, it } from "vitest";
import {
  ApiError,
  ERROR_CODES,
  conflict,
  errorResponse,
  forbidden,
  insufficientStock,
  internalError,
  notFound,
  notFoundError,
  planLimitReached,
  subscriptionReadOnly,
  unauthenticated,
  validationError,
} from "./api-error";

async function read(response: Response) {
  return { status: response.status, body: await response.json() };
}

describe("error mapping (BL29)", () => {
  it("validationError is 400 with details", async () => {
    const result = await read(validationError("Data tidak valid.", { field: "name" }));
    expect(result).toEqual({
      status: 400,
      body: { code: "VALIDATION_ERROR", message: "Data tidak valid.", details: { field: "name" } },
    });
  });

  it("unauthenticated is 401", async () => {
    const result = await read(unauthenticated());
    expect(result.status).toBe(401);
    expect(result.body.code).toBe("UNAUTHENTICATED");
    expect(result.body.details).toBeNull();
  });

  it("forbidden is 403", async () => {
    const result = await read(forbidden());
    expect(result.status).toBe(403);
    expect(result.body.code).toBe("FORBIDDEN");
  });

  it("notFound is 404 and does not say whether the resource exists in another tenant", async () => {
    const result = await read(notFound());
    expect(result.status).toBe(404);
    expect(result.body.code).toBe("NOT_FOUND");
  });

  it("conflict is 409", async () => {
    const result = await read(conflict("Data sudah ada."));
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("CONFLICT");
  });

  it("insufficientStock is 409 with its own code", async () => {
    const result = await read(insufficientStock({ available: 2 }));
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("INSUFFICIENT_STOCK");
    expect(result.body.details).toEqual({ available: 2 });
  });

  it("planLimitReached and subscriptionReadOnly are 403 with constant codes", async () => {
    expect(ERROR_CODES.PLAN_LIMIT_REACHED).toBe("PLAN_LIMIT_REACHED");
    expect(ERROR_CODES.SUBSCRIPTION_READ_ONLY).toBe("SUBSCRIPTION_READ_ONLY");
    const limit = await read(planLimitReached({ limit: 3 }));
    const readOnly = await read(subscriptionReadOnly());
    expect(limit.status).toBe(403);
    expect(limit.body.code).toBe("PLAN_LIMIT_REACHED");
    expect(limit.body.details).toEqual({ limit: 3 });
    expect(readOnly.status).toBe(403);
    expect(readOnly.body.code).toBe("SUBSCRIPTION_READ_ONLY");
  });

  it("internalError is 500 and only has code, message and details", async () => {
    const result = await read(internalError());
    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      code: "INTERNAL_ERROR",
      message: "Terjadi kesalahan pada server.",
      details: null,
    });
    expect(JSON.stringify(result.body)).not.toMatch(/stack| at /i);
  });

  it("errorResponse keeps the { code, message, details } shape", async () => {
    const result = await read(errorResponse(418, "X", "y"));
    expect(Object.keys(result.body).sort()).toEqual(["code", "details", "message"]);
  });
});

describe("notFoundError (rule 2: one 404 for missing and foreign rows)", () => {
  it("is an ApiError 404 NOT_FOUND", () => {
    const error = notFoundError();
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
  });

  it("builds the same body as notFound()", async () => {
    expect(await notFoundError().toResponse().text()).toBe(await notFound().text());
  });
});
