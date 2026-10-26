import { Prisma } from "../generated/prisma/client";
import { ApiError, ERROR_CODES } from "./api-error";

// Prisma reports a violated unique constraint as P2002. Services (warehouse code, product SKU) call
// this so a duplicate becomes a 409 with a message for the user, never a 500 (BL29).
export async function conflictOnUnique<T>(action: () => Promise<T>, message: string): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, ERROR_CODES.CONFLICT, message);
    }
    throw error;
  }
}
