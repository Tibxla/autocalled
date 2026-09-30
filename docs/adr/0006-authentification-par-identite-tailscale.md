# Authentification par l'identité Tailscale, sans page de connexion

L'interface de l'opérateur n'est servie que sur le tailnet, via `tailscale serve`, qui injecte l'identité de l'appelant dans l'en-tête `Tailscale-User-Login`. Le backend compare cet en-tête à l'identité de l'opérateur, attendue dans une variable d'environnement, et refuse tout le reste. Il n'y a ni mot de passe, ni session, ni page de connexion à maintenir pour un produit à opérateur unique. Ce choix suppose que l'application n'est jamais joignable autrement que derrière `tailscale serve` : elle n'écoute que sur 127.0.0.1, et aucun port n'est ouvert sur Internet.

## Consequences

- L'identité suit toute requête partie d'un appareil de l'opérateur, même lancée par une page tierce : aucune page ne se laisse encadrer (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), et la prise de main vérifie aussi l'origine (ADR 0008).
- L'application ne sert que l'hôte de `ORIGINE_APP` et les adresses de bouclage : une page qui se fait résoudre vers 127.0.0.1 (rebinding DNS) arrive avec son propre nom d'hôte et reçoit un refus, même si elle pose l'en-tête d'identité.
- L'identité simulée du développement (`OPERATEUR_DEV_LOGIN`) ne vaut que pour une requête locale directe, jamais pour une requête relayée par `tailscale serve` (nœud tagué, Funnel).
- Risque accepté : un processus de la machine peut écrire sur 127.0.0.1 l'en-tête qu'il veut, et devient alors l'opérateur. La machine n'a qu'un opérateur, et un processus de son compte lit de toute façon le `.env`. Le fermer demanderait de servir l'application sur un socket Unix en 0600 derrière `tailscale serve`, ce que `next start` ne sait pas faire.
