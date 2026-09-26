'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Rafraîchit la page tant que l'appel est en cours de traitement. */
export function Actualisation({ secondes = 3 }: { secondes?: number }) {
  const router = useRouter();
  useEffect(() => {
    const minuterie = setInterval(() => router.refresh(), secondes * 1000);
    return () => clearInterval(minuterie);
  }, [router, secondes]);
  return null;
}
