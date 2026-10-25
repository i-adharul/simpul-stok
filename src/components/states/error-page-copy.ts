// Texts come from the S23 design screen (issue #40 decision). The 500 text is fixed on purpose:
// it never shows the error message, so no internal detail reaches the user (BL29).
export const errorPageCopy = {
  404: {
    title: "Halaman tidak ditemukan",
    description:
      "Tautan atau halaman yang Anda cari mungkin sudah dipindahkan, dihapus, atau alamat URL salah ketik.",
  },
  403: {
    title: "Anda tidak punya akses ke halaman ini",
    description: "Hubungi Owner organisasi Anda jika Anda membutuhkan akses.",
  },
  500: {
    title: "Terjadi kesalahan di sisi kami",
    description: "Silakan coba muat ulang halaman.",
  },
} as const;

export type ErrorStatus = keyof typeof errorPageCopy;
