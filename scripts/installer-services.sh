#!/bin/bash
# Construit l'interface et installe ses unités utilisateur : le service de l'interface et le minuteur de la purge
# (redémarrent seuls, y compris après un redémarrage du serveur grâce au « linger » systemd).
set -euo pipefail
racine="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$racine/apps/web" && pnpm exec next build)
mkdir -p ~/.config/systemd/user
# Les unités sont des modèles : le dossier du dépôt (où qu'il soit cloné) et le PATH qui mène à node, pnpm et
# claude y sont écrits à l'installation, comme pour le pont (scripts/installer-pont.sh).
for outil in node pnpm claude; do
  command -v "$outil" >/dev/null || { echo "✗ $outil introuvable dans le PATH : installe-le, puis relance ce script."; exit 1; }
done
chemin="$(dirname "$(command -v claude)"):$(dirname "$(command -v node)"):$(dirname "$(command -v pnpm)"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
chemin="$(printf '%s' "$chemin" | tr ':' '\n' | awk '!vu[$0]++' | paste -sd:)"
for modele in "$racine"/deploy/systemd/*.service.modele; do
  case "$(basename "$modele")" in autocalled-pont.*) continue ;; esac # posé par scripts/installer-pont.sh
  sed -e "s|@RACINE@|$racine|g" -e "s|@PATH@|$chemin|g" "$modele" > ~/.config/systemd/user/"$(basename "$modele" .modele)"
done
cp "$racine"/deploy/systemd/*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now autocalled-web.service
systemctl --user restart autocalled-web.service
systemctl --user --no-pager status autocalled-web.service | grep -E "●|Active"
# Purge quotidienne des données passées la durée de conservation (ADR 0014) : seul le minuteur est activé, il lance
# le service. `pnpm purger --essai` montre d'abord ce qui partirait.
systemctl --user enable --now autocalled-purge.timer
systemctl --user --no-pager list-timers autocalled-purge.timer
