import { History, ShieldCheck, Warehouse } from "lucide-react";

const benefits = [
  {
    icon: Warehouse,
    title: "Multi-gudang",
    text: "Pantau dan kelola stok di seluruh cabang dan gudang pusat secara terpusat.",
  },
  {
    icon: History,
    title: "Riwayat stok yang tidak bisa diubah",
    text: "Setiap perpindahan dan penyesuaian stok tercatat permanen dan transparan.",
  },
  {
    icon: ShieldCheck,
    title: "Akses sesuai peran",
    text: "Batasi wewenang operasional khusus untuk Owner, Admin Gudang, dan Viewer.",
  },
];

export function BrandPanel() {
  return (
    <section className="flex flex-col gap-10 border-b bg-secondary/35 p-8 lg:w-[45%] lg:border-r lg:border-b-0 lg:p-14">
      <div className="flex items-center gap-2">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary font-heading font-bold text-primary-foreground">
          S
        </div>
        <span className="font-heading text-xl font-bold tracking-tight">Simpul</span>
        <span className="rounded bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
          Stok
        </span>
      </div>
      <div className="max-w-lg space-y-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight lg:text-4xl">
          Semua cabang, satu simpul.
        </h1>
        <p className="text-muted-foreground">
          Platform manajemen inventori multi-cabang terpadu untuk operasional UKM yang rapi dan
          terukur.
        </p>
      </div>
      <ul className="hidden max-w-lg space-y-3 lg:block">
        {benefits.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex items-start gap-3.5 rounded-xl border bg-card/80 p-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
              <Icon className="size-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-sm font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
