#!/bin/bash
# Despliega NAVES en orden: primero el backend y, cuando ya corre, el frontend.
# Un push a main NO despliega: hay que correr esto (o lanzarlo desde EasyPanel).
#
# Uso:
#   ./scripts/deploy-sequential.sh              despliega backend y luego frontend
#   ./scripts/deploy-sequential.sh --comprobar  solo verifica el acceso a EasyPanel, no despliega
#
# El token de EasyPanel NO va en el repo: se lee de $EASYPANEL_TOKEN o del
# archivo $EASYPANEL_TOKEN_FILE (por defecto ~/.easypanel_token).
#
# No se da por desplegado un servicio porque responda: el sitio sigue
# respondiendo con la versión anterior mientras construye, y EasyPanel a veces
# acepta la orden y no construye. Se espera a que su contenedor sea NUEVO
# (otra fecha de creación) y esté sano.

set -euo pipefail

API="https://netcloudnetworking.cloud/api/mcp"
PROYECTO="naves"
TOKEN="${EASYPANEL_TOKEN:-$(cat "${EASYPANEL_TOKEN_FILE:-$HOME/.easypanel_token}" 2>/dev/null || true)}"
[ -n "$TOKEN" ] || { echo "Falta el token de EasyPanel (EASYPANEL_TOKEN o ~/.easypanel_token)."; exit 1; }

# llamar <execute_query|execute_destructive> <procedimiento> '<input json>'
llamar() {
  curl -s "$API" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":{\"procedure\":\"$2\",\"input\":$3}}}"
}

# Fecha de creación y estado del contenedor MÁS NUEVO de un servicio: "<creado> <healthy|arrancando|Up|…>".
# Durante un despliegue sin caída conviven el viejo y el nuevo: se mira el más reciente.
contenedor() {
  llamar execute_query getDockerContainers "{\"service\":\"${PROYECTO}_$1\"}" | python3 -c '
import re, sys
t = sys.stdin.read().replace("\\\"", "\"")
mejor = (0, "?")
for c in re.split(r"(?=\"Id\":\"[0-9a-f]{64}\")", t):
    cr = re.search(r"\"Created\":(\d+)", c); st = re.search(r"\"Status\":\"([^\"]+)\"", c)
    if not cr or not st: continue
    s = st.group(1)
    estado = "healthy" if "(healthy)" in s else "arrancando" if "health" in s else "Up" if s.startswith("Up") else s.split()[0]
    if int(cr.group(1)) > mejor[0]: mejor = (int(cr.group(1)), estado)
print(mejor[0], mejor[1])'
}

desplegar() {
  local servicio=$1 antes creado estado limite
  read -r antes _ <<<"$(contenedor "$servicio")"
  echo "=== $servicio: lanzando el despliegue"
  llamar execute_destructive deployAppService "{\"projectName\":\"$PROYECTO\",\"serviceName\":\"$servicio\"}" >/dev/null
  limite=$((SECONDS + 600))
  while [ $SECONDS -lt $limite ]; do
    sleep 20
    read -r creado estado <<<"$(contenedor "$servicio")"
    echo "  [$(date +%H:%M:%S)] contenedor ${creado} (${estado})"
    if [ "$creado" != "$antes" ] && { [ "$estado" = "healthy" ] || [ "$estado" = "Up" ]; }; then
      echo "  ✓ $servicio publicado"; return 0
    fi
  done
  echo "  ✗ $servicio no se publicó en 10 min. EasyPanel pudo perder la orden: relanzar."
  return 1
}

if [ "${1:-}" = "--comprobar" ]; then
  for s in backend frontend; do
    read -r creado estado <<<"$(contenedor "$s")"
    [ "$creado" != "0" ] || { echo "✗ no se encontró el contenedor de $s (¿token o nombre?)"; exit 1; }
    echo "✓ $s: contenedor creado $(date -r "$creado" '+%d/%m/%Y %H:%M') — $estado"
  done
  exit 0
fi

desplegar backend
curl -sf -o /dev/null https://naves-inalde.com/api/health || { echo "✗ el backend no responde en /api/health"; exit 1; }
desplegar frontend
curl -sf -o /dev/null https://naves-inalde.com/ || { echo "✗ el frontend no responde"; exit 1; }
echo "✅ NAVES desplegado: backend y frontend."
