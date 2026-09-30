import { classesAction } from '@/components/classes-action';
import { Chevron } from '@/components/ui';
import { LIBELLES_ETAT, segmenter, type SegmentResolu } from '@/lib/vue-assistante';

/**
 * Blocs de lecture de la page Assistante, sans état : textes longs repliables, `{{variables}}` en évidence,
 * liens de téléchargement. Utilisables côté serveur.
 */

/** Une `{{variable}}` du texte brut : en chasse fixe, sur le surlignage d'un terme trouvé. */
function Variable({ nom }: { nom: string }) {
  return <span className="rounded-[2px] bg-filet-2 px-0.5 font-mono text-[0.9em] text-encre [overflow-wrap:anywhere]">{`{{${nom}}}`}</span>;
}

/** Un texte dont les `{{variables}}` ressortent. */
export function TexteAvecVariables({ texte }: { texte: string }) {
  return (
    <>
      {segmenter(texte).map((s, i) => (s.type === 'texte' ? <span key={i}>{s.texte}</span> : <Variable key={i} nom={s.nom} />))}
    </>
  );
}

/**
 * Le texte résolu : chaque valeur venue d'une variable surlignée, son nom en infobulle ; les manques en encre sourde.
 * Une variable vide ne transmet rien : l'écran le dit par un marqueur, que le texte téléchargé ne porte pas.
 */
export function TexteResolu({ segments }: { segments: readonly SegmentResolu[] }) {
  return (
    <>
      {segments.map((s, i) => {
        if (s.type === 'texte') return <span key={i}>{s.texte}</span>;
        if (s.type === 'inconnue') return <Variable key={i} nom={s.nom} />;
        if (s.etat === 'vide' || s.etat === 'selon-la-fiche') {
          return (
            <span key={i} title={`{{${s.nom}}}`} className="rounded-[2px] bg-filet-2 px-0.5 font-mono text-[0.9em] text-encre-3 [overflow-wrap:anywhere]">
              {s.etat === 'vide' ? `[${LIBELLES_ETAT.vide}]` : s.texte}
            </span>
          );
        }
        return (
          <mark
            key={i}
            title={`{{${s.nom}}}${s.etat === 'par-defaut' ? ` : ${LIBELLES_ETAT['par-defaut']}` : ''}`}
            className={`rounded-[2px] bg-filet-2 box-decoration-clone px-0.5 ${s.etat === 'par-defaut' ? 'text-encre-2' : 'text-encre'}`}
          >
            {s.texte}
          </mark>
        );
      })}
    </>
  );
}

/**
 * Un texte long posé sur la surface, replié derrière son résumé ; retours à la ligne gardés, sans défilement horizontal.
 * Le résumé est une action normale en texte : souligné au survol, en permanence au doigt, 44 px de haut.
 */
export function BlocRepliable({ resume, ouvert = false, children }: { resume: string; ouvert?: boolean; children: React.ReactNode }) {
  return (
    <details className="group min-w-0" open={ouvert}>
      <summary className={`${classesAction('normal')} -mx-1.5 cursor-pointer list-none max-sm:h-11 [&::-webkit-details-marker]:hidden`}>
        <Chevron className="stroke-encre-3 group-open:rotate-90" />
        {resume}
      </summary>
      <div className="mt-2 max-w-[80ch] rounded-md bg-surface px-3 py-3 text-base leading-relaxed break-words whitespace-pre-wrap sm:px-4">{children}</div>
    </details>
  );
}

/**
 * Un téléchargement : une action normale en texte, soulignée en permanence au doigt, 44 px au doigt et sur petit
 * écran. Lien simple, jamais un <Link> : un préchargement lancerait le téléchargement.
 */
export function LienTelechargement({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} download className={`${classesAction('normal')} -mx-1.5 justify-self-start max-sm:h-11`}>
      {children}
    </a>
  );
}
