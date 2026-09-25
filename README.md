# Autocalled

Une assistante vocale IA qui passe de vrais appels de prospection sur un vrai réseau mobile, propose des créneaux lus dans Google Agenda, réserve le rendez-vous, puis rédige le bilan de chaque appel.

> **Statut : en conception.** Le vocabulaire du domaine et les décisions d'architecture sont écrits ; le code commence par un spike sur la ligne Bluetooth.

## Le parcours d'un appel

1. L'opérateur choisit une **entreprise** à représenter, un **prospect** et une **version de script**.
2. Le serveur vérifie que le numéro du prospect est un **numéro autorisé**, puis fait composer l'appel à un **téléphone passerelle** appairé en Bluetooth.
3. **Mina**, l'assistante (un agent ElevenLabs), suit le script, répond aux objections de l'entreprise et s'appuie sur l'historique des appels précédents avec ce prospect. Elle parle comme une humaine, avec des réactions et des hésitations.
4. Si le prospect est intéressé, elle propose deux ou trois créneaux libres et réserve le **rendez-vous** dans un calendrier dédié.
5. À la fin de l'appel, l'audio et la transcription sont rapatriés, et un **bilan** est produit : issue, étape atteinte, objections levées ou non (chacune justifiée par une citation), points forts et points faibles.
6. L'écran d'analyse compare les versions de script d'une même entreprise, sans désigner de gagnant tant que l'échantillon est trop petit.

## Architecture

```mermaid
flowchart LR
    subgraph Tailnet["Tailnet (privé)"]
        UI["Interface opérateur<br/>Next.js"]
    end

    subgraph Serveur["Serveur du homelab"]
        API["API + domaine<br/>TypeScript"]
        DB[("Postgres")]
        WH["Webhooks publics<br/>port distinct"]
        Bridge["Pont Bluetooth<br/>oFono + PipeWire"]
        Analyseur["Analyseur<br/>claude -p, sans outils"]
    end

    Phone["Téléphone passerelle"]
    Prospect["Téléphone du prospect"]
    EL["ElevenLabs<br/>agent vocal"]
    GCal["Google Agenda"]

    UI -->|tailscale serve| API
    API --> DB
    API -->|lance l'appel| Bridge
    Bridge <-->|Bluetooth HFP| Phone
    Phone <-->|réseau mobile| Prospect
    Bridge <-->|audio WebSocket| EL
    EL -->|outils d'agenda, fin d'appel| WH
    WH --> API
    API --> GCal
    API --> Analyseur
```

## Décisions

Chaque choix qui surprendrait un lecteur est expliqué dans un ADR :

| ADR | Décision |
|---|---|
| [0001](docs/adr/0001-demo-fermee-numeros-autorises.md) | Démo fermée : l'assistante n'appelle que des numéros autorisés, informés au préalable |
| [0002](docs/adr/0002-agenda-par-outils-webhook-maison.md) | Agenda par outils webhook maison plutôt que l'intégration Cal.com |
| [0003](docs/adr/0003-ligne-bluetooth-via-telephone-passerelle.md) | Première ligne : un téléphone passerelle en Bluetooth plutôt que Twilio |
| [0004](docs/adr/0004-heberge-sur-le-homelab.md) | Hébergé sur le homelab, pas dans le cloud |
| [0005](docs/adr/0005-bilan-par-claude-code-en-mode-headless.md) | Bilan produit par Claude Code en mode headless |
| [0006](docs/adr/0006-authentification-par-identite-tailscale.md) | Authentification par l'identité Tailscale |

Le vocabulaire du domaine (entreprise, prospect, script, objection, issue, bilan…) est défini dans [CONTEXT.md](CONTEXT.md). Le code utilise ces mots-là et pas d'autres.

## Cadre légal

Autocalled est une démo fermée : Mina n'appelle que des personnes qui ont accepté, au préalable, d'être appelées par une IA et enregistrées. C'est pour cela qu'elle ne s'annonce pas comme IA pendant l'appel. Pour démarcher de vrais prospects, ce ne serait pas permis en l'état : l'AI Act (art. 50, en vigueur depuis le 2 août 2026) impose d'informer la personne qu'elle parle à une IA, le droit français impose de la prévenir de l'enregistrement, et depuis le 11 août 2026 le démarchage téléphonique des particuliers exige leur consentement préalable. Le détail est dans l'[ADR 0001](docs/adr/0001-demo-fermee-numeros-autorises.md).

## Ce que ce dépôt ne contient pas

Aucun secret, aucun numéro de téléphone réel, aucun enregistrement ni aucune transcription d'appel. La configuration passe par des variables d'environnement, documentées dans un `.env.example` sans valeurs.
