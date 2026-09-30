#!/bin/bash
# Ligne téléphonique (ADR 0003 et 0007) : paquets système, environnement Python du pont, règle D-Bus
# d'oFono, secret partagé avec l'application, service utilisateur. Peut être relancé sans risque.
# Matériel : une clé Bluetooth reconnue par Linux et un téléphone avec sa carte SIM (appairage depuis
# la page « Ligne téléphonique » de l'application).
set -euo pipefail
# Tout ce que crée ce script (.env, environnement Python) n'est lisible que par son compte.
umask 077
racine="$(cd "$(dirname "$0")/.." && pwd)"
utilisateur="$(id -un)"

echo "→ paquets système (BlueZ, oFono, Python, libsbc pour le mSBC)"
sudo apt-get install -y -q bluez ofono python3-dbus python3-gi python3-venv python3-numpy libsbc1 >/dev/null
sudo systemctl enable --now bluetooth ofono

# oFono et le mains-libres de PipeWire (WirePlumber) se disputent le même profil : un seul doit le tenir.
if systemctl --user is-active --quiet wireplumber 2>/dev/null; then
  echo "⚠ WirePlumber tourne : il peut prendre le profil mains-libres à oFono. Désactive son module bluez (hfp) ou arrête-le."
fi

echo "→ règle D-Bus : $utilisateur peut piloter oFono"
sed "s/@UTILISATEUR@/$utilisateur/" "$racine/deploy/dbus/autocalled-ofono.conf" | sudo install -m 644 /dev/stdin /etc/dbus-1/system.d/autocalled-ofono.conf
sudo systemctl reload dbus

echo "→ environnement Python du pont"
python3 -m venv --system-site-packages "$racine/apps/pont/.venv"
"$racine/apps/pont/.venv/bin/pip" install -q -r "$racine/apps/pont/requirements.txt" -c "$racine/apps/pont/contraintes.txt"

echo "→ secret partagé (PONT_SECRET dans .env)"
touch "$racine/.env"
chmod 600 "$racine/.env"
if ! grep -q '^PONT_SECRET=.\+' "$racine/.env"; then
  sed -i '/^PONT_SECRET=/d' "$racine/.env"
  echo "PONT_SECRET=$(openssl rand -hex 32)" >> "$racine/.env"
fi

# Redémarrer le pont coupe l'appel en cours, dont la fin n'atteindrait jamais l'application.
secret="$(grep '^PONT_SECRET=' "$racine/.env" | cut -d= -f2-)"
# L'en-tête passe par l'entrée standard : en argument, le secret serait visible de tout compte local (ps).
if printf 'Authorization: Bearer %s\n' "$secret" | curl -s -m 3 -H @- http://127.0.0.1:3021/etat 2>/dev/null | grep -q '"appelId": "'; then
  echo "✗ Un appel est en cours sur le téléphone passerelle : relance ce script une fois la ligne libre."
  exit 1
fi

echo "→ chemin de prise de main sur tailscale serve (ADR 0008)"
port_https="${PORT_HTTPS:-8449}"
port_ws="$(grep '^PONT_PORT_WS=' "$racine/.env" | cut -d= -f2-)"
sudo tailscale serve --bg --https="$port_https" --set-path=/prise-en-main "http://127.0.0.1:${port_ws:-3022}" >/dev/null

echo "→ service utilisateur autocalled-pont"
mkdir -p ~/.config/systemd/user
sed "s|@RACINE@|$racine|g" "$racine/deploy/systemd/autocalled-pont.service.modele" > ~/.config/systemd/user/autocalled-pont.service
loginctl show-user "$utilisateur" -p Linger | grep -q yes || sudo loginctl enable-linger "$utilisateur"
systemctl --user daemon-reload
systemctl --user enable --now autocalled-pont.service
systemctl --user restart autocalled-pont.service
systemctl --user --no-pager status autocalled-pont.service | grep -E "●|Active"
echo "L'application lit PONT_SECRET au démarrage : relance scripts/installer-services.sh si elle tournait déjà."
