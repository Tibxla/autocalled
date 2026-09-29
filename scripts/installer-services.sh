#!/bin/bash
# Construit l'interface et installe ses unités utilisateur : le service de l'interface et le minuteur de la purge
# (redémarrent seuls, y compris après un redémarrage du serveur grâce au « linger » systemd).
set -euo pipefail
racine="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$racine/apps/web" && pnpm exec next build)
mkdir -p ~/.config/systemd/user
cp "$racine"/deploy/systemd/*.service "$racine"/deploy/systemd/*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now autocalled-web.service
systemctl --user restart autocalled-web.service
systemctl --user --no-pager status autocalled-web.service | grep -E "●|Active"
# Purge quotidienne des données passées la durée de conservation (ADR 0014) : seul le minuteur est activé, il lance
# le service. `pnpm purger --essai` montre d'abord ce qui partirait.
systemctl --user enable --now autocalled-purge.timer
systemctl --user --no-pager list-timers autocalled-purge.timer
