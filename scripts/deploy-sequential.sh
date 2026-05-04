#!/bin/bash
# Despliega backend + frontend de forma SECUENCIAL para no saturar la VM.
# Espera a que cada servicio responda antes de disparar el siguiente.
#
# Uso: ./scripts/deploy-sequential.sh

set -e

BACKEND_DEPLOY="http://147.79.74.179:3000/api/deploy/35b55d6706b432aecb6fe448526c617d8f07c252a9f188bc"
FRONTEND_DEPLOY="http://147.79.74.179:3000/api/deploy/23d19f1ca4748fa619a40ac777c70892adeda2e4748a16c8"
BACKEND_HEALTH="https://naves-backend.huem98.easypanel.host/health"
FRONTEND_URL="https://naves-frontend.huem98.easypanel.host/"

wait_until_200() {
    local url=$1; local label=$2; local deadline=$((SECONDS + 360))
    echo "→ Esperando $label…"
    while [ $SECONDS -lt $deadline ]; do
        local code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$url")
        echo "  [$(date +%H:%M:%S)] $label = $code"
        [ "$code" = "200" ] && echo "  ✓ $label live" && return 0
        sleep 20
    done
    echo "  ✗ TIMEOUT esperando $label"
    return 1
}

echo "=== 1/2 Deploy backend ==="
curl -sX POST "$BACKEND_DEPLOY" && echo
wait_until_200 "$BACKEND_HEALTH" "backend" || exit 1

echo ""
echo "=== 2/2 Deploy frontend ==="
curl -sX POST "$FRONTEND_DEPLOY" && echo
wait_until_200 "$FRONTEND_URL" "frontend" || exit 1

echo ""
echo "✅ Ambos servicios live."
