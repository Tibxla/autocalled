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

/** Le texte résolu : chaque valeur venue d'une variable surlignée, son nom en infobulle ; les manques en encre sourde. */
export function TexteResolu({ segments }: { segments: readonly SegmentResolu[] }) {
  return (
    <>
      {segments.map((s, i) => {
        if (s.type === 'texte') return <span key={i}>{s.texte}</span>;
        if (s.type === 'inconnue') return <Variable key={i} nom={s.nom} />;
        if (s.etat === 'vide' || s.etat === 'selon-la-fiche') {
          return (
            <span key={i} title={`{{${s.nom}}}`} className="rounded-[2px] bg-filet-2 px-0.5 font-mono text-[0.9em] text-encre-3 [overflow-wrap:anywhere]">
              {s.texte}
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

/** Un texte long posé sur la surface, replié derrière son résumé ; retours à la ligne gardés, sans défilement horizontal. */
export function BlocRepliable({ resume, ouvert = false, children }: { resume: string; ouvert?: boolean; children: React.ReactNode }) {
  return (
    <details className="group min-w-0" open={ouvert}>
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-2 text-md text-encre-2 hover:text-encre max-sm:min-h-11 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        <Chevron className="stroke-encre-3 group-open:rotate-90" />
        <span className="decoration-souligne underline-offset-4 group-hover:underline">{resume}</span>
      </summary>
      <div className="mt-2 max-w-[80ch] rounded-md bg-surface px-3 py-3 text-base leading-relaxed break-words whitespace-pre-wrap sm:px-4">{children}</div>
    </details>
  );
}

/**
 * Un téléchargement : une action en texte comme les autres, 44 px au doigt et sur petit écran. Lien simple, jamais un
 * <Link> : un préchargement lancerait le téléchargement.
 */
export function LienTelechargement({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      download
      className="group -mx-1.5 inline-flex h-9 items-center justify-self-start rounded-[4px] px-1.5 text-md font-medium text-encre-2 transition-colors duration-150 hover:text-encre max-sm:h-11 pointer-coarse:h-11"
    >
      <span className="decoration-souligne decoration-1 underline-offset-4 group-hover:underline">{children}</span>
    </a>
  );
}
