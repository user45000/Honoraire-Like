#!/bin/bash
# Script de déploiement — à exécuter sur le VPS
# Usage : bash /opt/honoraire-like/deploy.sh
set -e
cd /opt/honoraire-like
git pull
node scripts/restore-calib.js
sudo systemctl restart honoraire-like
echo "✓ Déploiement terminé"
