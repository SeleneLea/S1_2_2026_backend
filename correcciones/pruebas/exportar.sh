#!/bin/bash
# Exporta tableros del diagramador local (Spring Boot + Flutter) y los descomprime,
# uno por tema, para poder probarlos por separado.
#
#   ./exportar.sh                          los cinco tableros de ejemplo
#   ./exportar.sh nombres-conflictivos     un diagrama de ./diagramas (lo carga y lo exporta)
#   ./exportar.sh tienda clinica           solo esos temas
#
# Variables: DIAGRAMADOR (http://localhost:8083), SALIDA, CORREO, CLAVE.
# El diagramador tiene que estar corriendo: cd backend && npm start
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"                 # .../backend
SALIDA="${SALIDA:-$RAIZ/temp/pruebas}"
DIAGRAMADOR="${DIAGRAMADOR:-http://localhost:8083}"
CORREO="${CORREO:-prueba1@gmail.com}"
CLAVE="${CLAVE:-12345678}"

set -a; . "$RAIZ/.env" >/dev/null 2>&1; set +a
export PGPASSWORD="${DB_PASSWORD:-}"
PSQL=$(ls "/c/Program Files/PostgreSQL"/*/bin/psql.exe 2>/dev/null | tail -1)
BASE_DIAGRAMADOR="${DB_NAME:-diagrama_dev}"
sql() { "$PSQL" -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5432}" -U "${DB_USER:-postgres}" \
        -d "$BASE_DIAGRAMADOR" -t -A "$@"; }

# Títulos de los cinco tableros de ejemplo que siembra el diagramador al arrancar.
declare -A TITULOS=(
  [tienda]='Tienda en línea'
  [biblioteca]='Biblioteca municipal'
  [clinica]='Clínica médica'
  [academico]='Gestión académica'
  [bancario]='Sistema bancario'
)

mkdir -p "$SALIDA"
echo "Salida: $SALIDA"

# ------------------------------------------------------------------ sesión
cookies="$SALIDA/.cookies.txt"
codigo=$(curl -s -m 60 -c "$cookies" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$CORREO\",\"password\":\"$CLAVE\"}" \
  "$DIAGRAMADOR/apis/login" -o "$SALIDA/.login.json" -w '%{http_code}')
if [ "$codigo" != "200" ]; then
  echo "✖ no pude iniciar sesión en $DIAGRAMADOR (HTTP $codigo). ¿Está corriendo npm start?"
  exit 1
fi

# ------------------------------------------------------ id del tablero a exportar
# Un tema conocido se busca por título; cualquier otro nombre se toma como
# archivo de ./diagramas y se carga como tablero de prueba antes de exportar.
idDeTema() {
  local tema="$1" titulo="${TITULOS[$1]:-}"
  if [ -n "$titulo" ]; then
    sql -c "SELECT id FROM \"Salas\" WHERE title = '$titulo' AND eliminar = false ORDER BY id DESC LIMIT 1;"
    return
  fi
  local archivo="$AQUI/diagramas/$tema.json"
  if [ ! -f "$archivo" ]; then echo ""; return; fi
  local usuario
  usuario=$(sql -c "SELECT id FROM \"Users\" WHERE email = '$CORREO' LIMIT 1;")
  [ -z "$usuario" ] && { echo ""; return; }
  # Se reemplaza el tablero de prueba anterior para no acumular copias
  sql -c "DELETE FROM \"Salas\" WHERE title = 'PRUEBA $tema';" >/dev/null
  python - "$archivo" "$tema" "$usuario" <<'PY' > "$SALIDA/.insertar.sql"
import json, sys
archivo, tema, usuario = sys.argv[1], sys.argv[2], sys.argv[3]
with open(archivo, encoding='utf-8') as f:
    diagrama = json.dumps(json.load(f), ensure_ascii=False)
print("INSERT INTO \"Salas\" (title, xml, userid) VALUES ('PRUEBA %s', %s, %s) RETURNING id;"
      % (tema, "$texto$" + diagrama + "$texto$", usuario))
PY
  sql -f "$SALIDA/.insertar.sql" | head -1
}

temas=("$@")
[ ${#temas[@]} -eq 0 ] && temas=(tienda biblioteca clinica academico bancario)

for tema in "${temas[@]}"; do
  id=$(idDeTema "$tema" | tr -d '[:space:]')
  printf '%-22s ' "$tema"
  if [ -z "$id" ]; then
    echo "✖ no encontré el tablero (ni ./diagramas/$tema.json)"
    continue
  fi
  destino="$SALIDA/$tema"
  rm -rf "$destino" && mkdir -p "$destino"
  cs=$(curl -s -m 900 -b "$cookies" -X POST \
       "$DIAGRAMADOR/apis/crearPagina/exportarSpringBoot/$id" -o "$destino/spring.zip" -w '%{http_code}')
  cf=$(curl -s -m 900 -b "$cookies" -X POST \
       "$DIAGRAMADOR/apis/crearPagina/exportarFlutter/$id" -o "$destino/flutter.zip" -w '%{http_code}')
  echo "tablero $id · spring $cs ($(du -k "$destino/spring.zip" | cut -f1) KB) · flutter $cf ($(du -k "$destino/flutter.zip" | cut -f1) KB)"
  if [ "$cs" != "200" ] || [ "$cf" != "200" ]; then
    echo "    ✖ la exportación falló; mira la consola de npm start"
    continue
  fi
  ( cd "$destino" && unzip -q -o spring.zip -d spring && unzip -q -o flutter.zip -d flutter )
done

rm -f "$SALIDA/.insertar.sql" "$SALIDA/.login.json"
echo "FIN"
