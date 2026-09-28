# Prendre la main : la voix de l'opérateur passe par un WebSocket direct vers le pont

Pendant un appel téléphone, l'opérateur peut prendre la main : Mina se tait, et il parle au prospect depuis son navigateur, avec son micro. Sa voix doit arriver au téléphone en quelques centaines de millisecondes, dans les deux sens. L'application Next.js ne sait pas relayer un WebSocket, et un flux HTTP montant ne passe pas en HTTP/1.1 dans Chrome. Le navigateur se connecte donc directement au pont, par un second chemin de `tailscale serve` (`/prise-en-main`, vers le WebSocket du pont sur 127.0.0.1). Le pont n'accepte la connexion que si l'identité Tailscale posée par `tailscale serve` est celle de l'opérateur : c'est le modèle de l'ADR 0006. Contrairement à ce que l'ADR 0007 refuse, personne ne se fait passer pour l'opérateur : c'est son navigateur qui entre par la porte prévue.

À la prise de main, le pont ferme la conversation ElevenLabs sans raccrocher, vide ce que Mina n'avait pas encore dit, puis relie le téléphone au navigateur : le prospect seul vers l'opérateur, la voix de l'opérateur vers le téléphone, après un court tampon qui absorbe les à-coups du réseau. L'opérateur s'annonce lui-même (« Thibaud à l'appareil, je prends le relais »).

## Considered Options

- Relayer par l'application (flux HTTP dans les deux sens) : pas de flux montant en HTTP/1.1 dans Chrome, et un saut de plus.
- WebRTC entre le navigateur et le pont : la meilleure latence, mais une pile lourde (négociation, ICE) pour un seul opérateur sur un réseau privé.
- Mina annonce le relais (« je vous passe Thibaud ») : l'API de conversation n'a pas de déclencheur propre pour lui faire dire une phrase à la demande ; à reprendre plus tard.

## Consequences

- La conversation ElevenLabs s'arrête au relais : la transcription et le bilan ne couvrent que la partie de Mina. L'enregistrement du pont garde tout l'appel.
- Le casque est recommandé : sans lui, le micro de l'opérateur peut reprendre ce que dit le prospect.
- La prise de main ne fonctionne qu'à travers `tailscale serve` (le pont exige l'identité qu'il pose) ; `scripts/installer-pont.sh` configure le chemin.
