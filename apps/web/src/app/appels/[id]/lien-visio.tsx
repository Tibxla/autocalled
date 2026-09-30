'use client';

import { classesAction } from '@/components/action';

/**
 * « Ouvrir la visio » d'un rendez-vous : un lien externe qui prend la forme d'une action forte (en relief au doigt).
 * Composant client parce que `classesAction` vit dans action.tsx, module client : la page, rendue côté serveur, ne
 * peut pas l'appeler elle-même.
 */
export function LienVisio({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={classesAction('fort', 'relief')}>
      Ouvrir la visio
    </a>
  );
}
