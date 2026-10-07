import { heure, jourCourt } from '@/components/format-appel';
import { LienAction, Message, TitreSection } from '@/components/ui';
import { lireDiagnosticEntrants } from '@/lib/diagnostic-entrants';
import { lireReglagesEntrants } from '@/lib/reglages-entrants';
import { FormulaireEntrants } from './formulaire-entrants';

export async function SectionEntrants({ nom }: { nom: string }) {
  const [reglages, diagnostic] = await Promise.all([lireReglagesEntrants(), lireDiagnosticEntrants()]);
  return (
    <section id="appels-entrants" aria-labelledby="titre-entrants" className="grid scroll-mt-[calc(var(--hauteur-barre)+16px)] gap-5">
      <TitreSection id="titre-entrants">Appels entrants</TitreSection>
      <p className="max-w-[62ch] text-sm text-encre-2">{nom} reconnaît la fiche du prospect à son numéro. Elle décroche seulement si ce prospect est actif, appelable et déjà appelé au téléphone. Un numéro inconnu ou masqué reste sans décroché.</p>
      <FormulaireEntrants nom={nom} {...reglages} />
      <div className="grid gap-3 border-t border-filet pt-4">
        <h3 className="text-md font-semibold">Diagnostic du décroché</h3>
        <Message ton={diagnostic.ligne.alerte ? 'alerte' : 'neutre'}>{diagnostic.ligne.texte}</Message>
        {!reglages.valeur.actif ? <p className="text-sm text-encre-2">Le décroché automatique est désactivé, même pour les prospects reconnus.</p> : null}
        {diagnostic.dernier ? (
          <div className="grid gap-2">
            <p className="text-sm text-encre-3">Dernier appel entrant reconnu : <time dateTime={diagnostic.dernier.le} className="font-mono">{jourCourt(new Date(diagnostic.dernier.le))} {heure(new Date(diagnostic.dernier.le))}</time>.</p>
            <Message ton={diagnostic.dernier.alerte ? 'alerte' : 'neutre'}>{diagnostic.dernier.texte}</Message>
            <LienAction href={`/appels/${diagnostic.dernier.id}`} ton="discret">Voir cet appel</LienAction>
          </div>
        ) : <p className="text-sm text-encre-3">Aucun appel entrant reconnu n’a encore été enregistré.</p>}
        <p className="max-w-[62ch] text-sm text-encre-3">Sans trace d’appel, les pistes sont un numéro inconnu ou masqué, un prospect archivé ou jamais appelé au téléphone, une opposition, ou une ligne déjà occupée. Aucun numéro refusé n’est conservé.</p>
        <LienAction href="/telephone" ton="discret">Vérifier le téléphone</LienAction>
      </div>
    </section>
  );
}
