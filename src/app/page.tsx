import { redirect } from "next/navigation";
import { getServerUser } from "@/modules/platform/server-session";

// Functional spec, Menus and redirects: "/" goes to /dashboard, or /login when not logged in.
export default async function Home() {
  redirect((await getServerUser()) ? "/dashboard" : "/login");
}
