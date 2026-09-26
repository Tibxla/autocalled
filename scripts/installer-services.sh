#!/bin/bash
# Construit l'interface et installe les deux services utilisateur (redémarrent seuls, y compris
# après un redémarrage du serveur grâce au « linger » systemd).
set -euo pipefail
racine="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$racine/apps/web" && pnpm exec next build)
mkdir -p ~/.config/systemd/user
cp "$racine"/deploy/systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now autocalled-web.service autocalled-outils.service
systemctl --user restart autocalled-web.service autocalled-outils.service
systemctl --user --no-pager status autocalled-web.service autocalled-outils.service | grep -E "●|Active"
