// Every auth response is about a credential or a person, so no cache may keep it.
export function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}
