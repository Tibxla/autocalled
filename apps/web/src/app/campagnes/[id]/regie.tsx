'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { AppelEnDirect } from '@/components/appel-en-direct';
import { Bouton } from '@/components/ui';
import { cloreAppelDeCampagne, lancerCampagne, ouvrirAppelSuivant, suspendreCampagne } from '../actions';

const PAUSE_SECONDES = 5;

/**
 * La régie d'une campagne. Sur la ligne navigateur, les appels s'enchaînent après un court décompte
 * qu'on peut passer ou suspendre ; en simulation, le serveur déroule seul et la page suit.
 */
export function Regie({
  campagneId,
  statut,
  ligne,
  entrepriseId,
  versionScriptId,
  prochain,
  appelOuvert,
}: {
  campagneId: string;
  statut: 'prete' | 'en-cours' | 'en-pause' | 'terminee';
  ligne: 'navigateur' | 'simulation';
  entrepriseId: string;
  versionScriptId: string;
  prochain: { id: string; nom: string } | null;
  appelOuvert: string | null;
}) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [lance, setLance] = useState<string | null>(null);
  const [enAppel, setEnAppel] = useState<string | null>(null);

  const auto = ligne === 'navigateur' && statut === 'en-cours' && prochain !== null && appelOuvert === null;

  useEffect(() => {
    if (ligne !== 'simulation' || statut !== 'en-cours') return;
    const minuterie = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(minuterie);
  }, [ligne, statut, router]);

  const controles = (
    <div className="flex flex-wrap items-center gap-3">
      {statut === 'prete' || statut === 'en-pause' ? (
        <Bouton type="button" disabled={enCours} onClick={() => demarrer(() => lancerCampagne(campagneId))}>
          {statut === 'prete' ? 'Lancer la campagne' : 'Reprendre'}
        </Bouton>
      ) : null}
      {statut === 'en-cours' ? (
        <Bouton type="button" variante="secondaire" disabled={enCours} onClick={() => demarrer(() => suspendreCampagne(campagneId))}>
          Pause
        </Bouton>
      ) : null}
      {statut === 'en-pause' ? <span className="text-sm text-encre-3">L’appel en cours va à son terme, aucun autre ne part.</span> : null}
    </div>
  );

  if (appelOuvert) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-encre-2">Un appel de cette campagne est resté ouvert (page fermée pendant l’appel ?).</p>
        <Bouton
          type="button"
          variante="secondaire"
          className="justify-self-start"
          disabled={enCours}
          onClick={() => demarrer(() => cloreAppelDeCampagne(campagneId, appelOuvert))}
        >
          Clore cet appel et continuer
        </Bouton>
      </div>
    );
  }

  if (statut === 'terminee') return <p className="text-encre-2">Campagne terminée.</p>;

  return (
    <div className="grid gap-6">
      {controles}
      {ligne === 'simulation' && statut === 'en-cours' ? (
        <p className="text-sm text-encre-2">Le serveur enchaîne les appels simulés ; la liste se met à jour toute seule.</p>
      ) : null}
      {auto && prochain ? (
        enAppel !== null || lance === prochain.id ? (
          <AppelEnDirect
            key={prochain.id}
            entrepriseId={entrepriseId}
            prospectId={prochain.id}
            prospectNom={prochain.nom}
            versionScriptId={versionScriptId}
            campagneId={campagneId}
            demarrageAuto
            ouvrir={async () => {
              const r = await ouvrirAppelSuivant(campagneId);
              if (r.ok) setEnAppel(r.appelId);
              return r;
            }}
            clore={(appelId) => cloreAppelDeCampagne(campagneId, appelId)}
            onFin={() => {
              setEnAppel(null);
              router.refresh();
            }}
          />
        ) : (
          <Decompte key={prochain.id} nom={prochain.nom} onFini={() => setLance(prochain.id)} />
        )
      ) : null}
    </div>
  );
}

/** Court décompte avant l'appel suivant ; remonté à chaque prospect grâce à sa clé. */
function Decompte({ nom, onFini }: { nom: string; onFini: () => void }) {
  const [reste, setReste] = useState(PAUSE_SECONDES);
  useEffect(() => {
    if (reste === 0) {
      onFini();
      return;
    }
    const minuterie = setTimeout(() => setReste((r) => r - 1), 1000);
    return () => clearTimeout(minuterie);
  }, [reste, onFini]);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-encre-2">
        Appel de <span className="font-medium text-encre">{nom}</span> dans <span className="font-mono">{reste}</span> s
      </p>
      <Bouton type="button" variante="discret" onClick={onFini}>
        Appeler maintenant
      </Bouton>
    </div>
  );
}
