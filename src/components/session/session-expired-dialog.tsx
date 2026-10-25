"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertDialog } from "radix-ui";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { onSessionExpired } from "@/lib/api-client";

// P19. Mounted once in the root layout and opened by apiFetch on a 401 UNAUTHENTICATED.
// It cannot be dismissed (the open state is never set to false): the only way out is S01.
export function SessionExpiredDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => onSessionExpired(() => setOpen(true)), []);

  return (
    <AlertDialog.Root open={open}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-95 -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-xl border bg-card p-6 text-center shadow-lg">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full border bg-background text-primary">
            <Clock className="size-6" aria-hidden />
          </div>
          <AlertDialog.Title className="font-heading text-lg font-bold">
            Sesi Anda telah berakhir
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-sm text-muted-foreground">
            Silakan masuk lagi untuk melanjutkan.
          </AlertDialog.Description>
          <Button
            className="mt-5 w-full"
            size="lg"
            onClick={() => {
              setOpen(false);
              router.push("/login");
            }}
          >
            Masuk lagi
          </Button>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
