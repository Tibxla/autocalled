'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function LienNav({ href, children, exact = false }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const chemin = usePathname();
  const actif = exact ? chemin === href : chemin === href || chemin.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={actif ? 'page' : undefined}
      className="rounded-md px-2.5 py-1.5 text-sm text-encre-2 transition-colors duration-150 hover:bg-survol hover:text-encre aria-[current=page]:text-encre aria-[current=page]:font-medium"
    >
      {children}
    </Link>
  );
}
