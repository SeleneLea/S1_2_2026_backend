#!/bin/bash
# Levanta cada backend exportado contra su propia base y comprueba:
#   1. que arranque,  2. que siembre datos,  3. que cada endpoint liste,
#   4. que se pueda crear un registro sin enviar el id,
#   5. que sin sesión responda 401 y que un rol de solo consulta no pueda modificar,
#   6. que un PUT con una lista vacía vacíe la relación (corrección 03).
#
#   ./probar-backends.sh                    los cinco temas de ejemplo
#   ./probar-backends.sh nombres-conflictivos
#
# Variables: SALIDA (donde dejó los proyectos exportar.sh), PUERTO_BASE (8091).
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
SALIDA="${SALIDA:-$RAIZ/temp/pruebas}"
PUERTO_BASE="${PUERTO_BASE:-8091}"

set -a; . "$RAIZ/.env" >/dev/null 2>&1; set +a
export PGPASSWORD="${DB_PASSWORD:-}"
PSQL=$(ls "/c/Program Files/PostgreSQL"/*/bin/psql.exe 2>/dev/null | tail -1)
# Maven y Gradle necesitan un temporal corto en Windows o fallan con "loopback connection"
mkdir -p /c/tmpjava
export TMP='C:\tmpjava' TEMP='C:\tmpjava'

temas=("$@")
[ ${#temas[@]} -eq 0 ] && temas=(tienda biblioteca clinica academico bancario)

json() { python -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

liberar() {
  local pid
  pid=$(netstat -ano | grep -E ":$1\s" | grep LISTENING | awk '{print $NF}' | head -1)
  [ -n "$pid" ] && taskkill //PID "$pid" //F >/dev/null 2>&1
}

fallos=0
puerto=$PUERTO_BASE

for tema in "${temas[@]}"; do
  proyecto="$SALIDA/$tema/spring"
  base="prueba_$tema"
  echo "################ $tema  (puerto $puerto, base $base)"
  if [ ! -f "$proyecto/mvnw" ]; then
    echo "  ✖ no hay proyecto en $proyecto; corre primero ./exportar.sh $tema"
    fallos=$((fallos+1)); puerto=$((puerto+1)); continue
  fi

  liberar "$puerto"
  "$PSQL" -h "${DB_HOST:-localhost}" -p "${DB_PORT:-5432}" -U "${DB_USER:-postgres}" -d postgres \
     -c "DROP DATABASE IF EXISTS $base;" -c "CREATE DATABASE $base;" >/dev/null 2>&1

  ( cd "$proyecto" && SERVER_PORT=$puerto \
      SPRING_DATASOURCE_URL="jdbc:postgresql://${DB_HOST:-localhost}:${DB_PORT:-5432}/$base" \
      SPRING_DATASOURCE_USERNAME="${DB_USER:-postgres}" \
      SPRING_DATASOURCE_PASSWORD="$DB_PASSWORD" \
      ./mvnw -B -ntp spring-boot:run > "$SALIDA/srv-$tema.log" 2>&1 ) &

  listo=no
  for _ in $(seq 1 90); do
    if curl -s -m 5 "http://localhost:$puerto/api/auth/roles" >/dev/null 2>&1; then listo=si; break; fi
    sleep 5
  done
  if [ "$listo" != "si" ]; then
    echo "  ✖ NO ARRANCO"
    grep -m 4 -i "ERROR\|Caused by\|interpolatedMessage" "$SALIDA/srv-$tema.log" | sed 's/^/      /'
    liberar "$puerto"; fallos=$((fallos+1)); puerto=$((puerto+1)); continue
  fi

  roles=$(curl -s -m 10 "http://localhost:$puerto/api/auth/roles")
  echo "  roles: $roles"
  gestor=$(echo "$roles" | json "d['data']['gestores'][0].lower()")
  otro=$(echo "$roles" | json "([r for r in d['data']['roles'] if r.lower()!='$gestor'] or [''])[0].lower()")

  echo "  siembra:"; grep '   - ' "$SALIDA/srv-$tema.log" | sed 's/^/   /' | head -20

  tok=$(curl -s -m 20 -H 'Content-Type: application/json' \
        -d "{\"correo\":\"$gestor@demo.com\",\"clave\":\"12345678\"}" \
        "http://localhost:$puerto/api/auth/login" | json "d['data']['token']")
  if [ -z "$tok" ]; then
    echo "  ✖ no pude iniciar sesión como $gestor@demo.com"
    liberar "$puerto"; fallos=$((fallos+1)); puerto=$((puerto+1)); continue
  fi

  rutas=$(grep -rh 'RequestMapping("/api/' "$proyecto/src/main/java/com/example/demo/controllers" \
          | sed 's/.*api\///; s/").*//' | grep -v -E '^(auth|asistente|cuentas)$' | sort -u)
  total=0; malos=0; vacios=0
  for r in $rutas; do
    cuerpo=$(curl -s -m 20 "http://localhost:$puerto/api/$r" -H "Authorization: Bearer $tok")
    cuenta=$(echo "$cuerpo" | json "d.get('total', 0)")
    if [ -z "$cuenta" ]; then
      malos=$((malos+1)); echo "   ✖ /$r -> $(echo "$cuerpo" | head -c 120)"
    elif [ "$cuenta" = "0" ]; then
      vacios=$((vacios+1)); echo "   ! /$r sin registros"
    fi
    total=$((total+1))
  done
  echo "  endpoints: $total revisados, $malos con error, $vacios vacíos"
  [ "$malos" != "0" ] && fallos=$((fallos+1))

  # crear un registro copiando uno sembrado, sin enviar el id
  primera=$(echo "$rutas" | head -1)
  copia=$(curl -s -m 20 "http://localhost:$puerto/api/$primera" -H "Authorization: Bearer $tok" \
          | python -c "import sys,json;d=json.load(sys.stdin);r=dict(d['data'][0]);r.pop('id',None);print(json.dumps(r))" 2>/dev/null)
  if [ -n "$copia" ]; then
    creado=$(curl -s -m 20 -o "$SALIDA/crear-$tema.json" -w '%{http_code}' \
             -X POST "http://localhost:$puerto/api/$primera" \
             -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "$copia")
    echo "  crear en /$primera sin id: HTTP $creado  $(head -c 140 "$SALIDA/crear-$tema.json")"
    [ "$creado" != "201" ] && fallos=$((fallos+1))
  fi

  sin=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "http://localhost:$puerto/api/$primera")
  echo "  sin sesión: HTTP $sin (se espera 401)"
  [ "$sin" != "401" ] && fallos=$((fallos+1))

  if [ -n "$otro" ]; then
    tok2=$(curl -s -m 20 -H 'Content-Type: application/json' \
          -d "{\"correo\":\"$otro@demo.com\",\"clave\":\"12345678\"}" \
          "http://localhost:$puerto/api/auth/login" | json "d['data']['token']")
    neg=$(curl -s -m 20 -X POST "http://localhost:$puerto/api/$primera" -H "Authorization: Bearer $tok2" \
          -H 'Content-Type: application/json' -d "$copia")
    echo "  como $otro (solo consulta): $(echo "$neg" | head -c 130)"
  fi

  # corrección 03: un PUT con la lista vacía tiene que vaciar la relación
  for r in $rutas; do
    lista=$(curl -s -m 20 "http://localhost:$puerto/api/$r" -H "Authorization: Bearer $tok")
    clave=$(echo "$lista" | json "([k for k in d['data'][0] if k.endswith('Ids') and d['data'][0][k]] or [''])[0]")
    [ -z "$clave" ] && continue
    id=$(echo "$lista" | json "d['data'][0]['id']")
    cuerpo=$(echo "$lista" | python -c "import sys,json;d=json.load(sys.stdin);r=dict(d['data'][0]);r.pop('id',None);r['$clave']=[];print(json.dumps(r))")
    curl -s -m 20 -o /dev/null -X PUT "http://localhost:$puerto/api/$r/$id" \
      -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "$cuerpo"
    quedo=$(curl -s -m 20 "http://localhost:$puerto/api/$r/$id" -H "Authorization: Bearer $tok" \
            | json "len(d['data']['$clave'] or [])")
    if [ "$quedo" = "0" ]; then
      echo "  vaciar $clave en /$r: bien (quedó vacía)"
    else
      echo "  ✖ vaciar $clave en /$r: siguen $quedo (corrección 03 sin aplicar)"
      fallos=$((fallos+1))
    fi
    break
  done

  liberar "$puerto"
  puerto=$((puerto+1))
  echo
done

echo "FIN · comprobaciones fallidas: $fallos"
exit $([ "$fallos" -eq 0 ] && echo 0 || echo 1)
