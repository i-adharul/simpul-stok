// BL29 / CLAUDE.md rule 10: every error body is { code, message, details }, never a stack trace.
export function errorResponse(
  status: number,
  code: string,
  message: string,
  details: unknown = null,
): Response {
  return Response.json({ code, message, details }, { status });
}
