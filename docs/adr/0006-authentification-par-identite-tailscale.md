# Authentification par l'identité Tailscale, sans page de connexion

L'interface de l'opérateur n'est servie que sur le tailnet, via `tailscale serve`, qui injecte l'identité de l'appelant dans l'en-tête `Tailscale-User-Login`. Le backend compare cet en-tête à l'identité de l'opérateur, attendue dans une variable d'environnement, et refuse tout le reste. Il n'y a ni mot de passe, ni session, ni page de connexion à maintenir pour un produit à opérateur unique. Ce choix suppose que l'application n'est jamais joignable autrement que derrière `tailscale serve` : les points d'entrée publics (Funnel) sont des webhooks authentifiés par signature ou secret, et ils ne servent aucune page.

## Consequences

- Une requête arrivée par Funnel vient d'Internet et peut porter un en-tête `Tailscale-User-Login` forgé. Les webhooks publics tournent donc sur un port distinct de l'interface, et seul ce port est exposé par Funnel ; le port de l'interface n'accepte que le trafic de `tailscale serve`.
