#!/bin/bash
# Script de déploiement — à exécuter sur le VPS
# Usage : bash /opt/honoraire-like/deploy.sh
set -e
cd /opt/honoraire-like
git pull
sudo node scripts/restore-calib.js
sudo chown www-data public/js/app.js data/fds-calib.json
sudo chmod 664 public/js/app.js data/fds-calib.json
sudo systemctl restart honoraire-like
echo "✓ Déploiement terminé"
