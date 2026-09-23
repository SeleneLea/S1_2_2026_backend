#!/bin/bash
# Prepara y analiza las apps Flutter exportadas: plataformas, dependencias y
# "flutter analyze", que es el mismo chequeo que corre el editor antes de compilar.
#
#   ./analizar-flutter.sh                    los cinco temas de ejemplo
#   ./analizar-flutter.sh nombres-conflictivos
#
# Variables: SALIDA (donde dejó los proyectos exportar.sh).
set -u

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
SALIDA="${SALIDA:-$RAIZ/temp/pruebas}"
# Gradle necesita un temporal corto en Windows o falla con "loopback connection"
mkdir -p /c/tmpjava
export TMP='C:\tmpjava' TEMP='C:\tmpjava'

temas=("$@")
[ ${#temas[@]} -eq 0 ] && temas=(tienda biblioteca clinica academico bancario)

fallos=0
for tema in "${temas[@]}"; do
  app="$SALIDA/$tema/flutter"
  printf '%-22s ' "$tema"
  if [ ! -f "$app/pubspec.yaml" ]; then
    echo "✖ no hay app en $app; corre primero ./exportar.sh $tema"
    fallos=$((fallos+1)); continue
  fi
  ( cd "$app" \
      && flutter create . --platforms android  > "$SALIDA/fl-crear-$tema.log" 2>&1 \
      && flutter pub get                      >> "$SALIDA/fl-crear-$tema.log" 2>&1 \
      && flutter analyze                       > "$SALIDA/fl-analyze-$tema.log" 2>&1 )
  if grep -q "No issues found" "$SALIDA/fl-analyze-$tema.log" 2>/dev/null; then
    echo "analyze OK ($(ls "$app/lib/screens/" 2>/dev/null | wc -l) pantallas)"
  else
    echo "PROBLEMAS:"
    grep -E "error|warning|info" "$SALIDA/fl-analyze-$tema.log" | head -8 | sed 's/^/      /'
    fallos=$((fallos+1))
  fi
done

echo "FIN · apps con problemas: $fallos"
exit $([ "$fallos" -eq 0 ] && echo 0 || echo 1)
