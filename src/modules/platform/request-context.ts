import type { PrismaClient, UserRole } from "../../generated/prisma/client";
import { ApiError, ERROR_CODES } from "../../lib/api-error";
import { getCurrentUser } from "./current-user";

// The only thing services and data access receive about "who is asking" (docs/05 section 1).
export type RequestContext = {
  userId: string;
  organizationId: string;
  role: UserRole;
  warehouseIds: string[];
};

// Plain Prisma client on purpose (rule 3 exception, like getCurrentUser): this runs before a
// tenant-scoped client can exist. Every query still filters by the session's organization.
async function resolveWarehouseIds(
  prisma: PrismaClient,
  user: { id: string; role: UserRole },
  organizationId: string,
): Promise<string[]> {
  // Owner sees every active warehouse; other roles only the ones assigned to them.
  const rows = await prisma.warehouse.findMany({
    where:
      user.role === "OWNER"
        ? { organizationId, archivedAt: null }
        : { organizationId, archivedAt: null, userWarehouses: { some: { userId: user.id } } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => row.id);
}

// Route handler boundary: throws ApiError so withApiLog builds the response. organizationId comes
// only from the user row found through the session cookie (rule 1), never from the request.
export async function getRequestContext(
  prisma: PrismaClient,
  secret: string,
  request: Request,
): Promise<RequestContext> {
  const current = await getCurrentUser(prisma, secret, request);
  if (!current) {
    throw new ApiError(401, ERROR_CODES.UNAUTHENTICATED, "Sesi tidak valid. Silakan masuk lagi.");
  }
  // A platform admin belongs to no organization, so tenant endpoints have nothing to scope to.
  if (!current.organization) {
    throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Anda tidak punya akses untuk tindakan ini.");
  }
  const { user, organization } = current;
  return {
    userId: user.id,
    organizationId: organization.id,
    role: user.role,
    warehouseIds: await resolveWarehouseIds(prisma, user, organization.id),
  };
}
