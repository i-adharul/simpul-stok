import { Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerUser } from "@/modules/platform/server-session";
import { ChangePasswordDialog } from "./change-password-dialog";

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: "Admin Platform",
  OWNER: "Owner",
  WAREHOUSE_ADMIN: "Admin Gudang",
  VIEWER: "Viewer",
};

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        {label}
        <Lock className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="text-xs font-normal text-muted-foreground">Hanya baca</span>
      </p>
      <p className="rounded-lg border bg-muted px-3 py-2 text-sm">{value}</p>
    </div>
  );
}

// S17. Same session check as the layout (it already redirects when there is none); name and
// email are read-only by design (functional spec, Account).
export default async function ProfilePage() {
  const current = await getServerUser();
  if (!current) return null;
  const { user, organization } = current;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profil saya</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kelola informasi profil dan keamanan akun Anda.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Informasi profil</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ReadOnlyField label="Nama lengkap" value={user.name} />
          <ReadOnlyField label="Alamat email" value={user.email} />
          <ReadOnlyField label="Peran" value={ROLE_LABELS[user.role] ?? user.role} />
          {organization && <ReadOnlyField label="Organisasi" value={organization.name} />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Keamanan</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Password</p>
            <p className="text-sm text-muted-foreground">
              Ganti password secara berkala untuk menjaga keamanan akun.
            </p>
          </div>
          <ChangePasswordDialog email={user.email} />
        </CardContent>
      </Card>
    </div>
  );
}
