#!/usr/bin/env bash
# Lanzador multiplataforma: no borra proyectos, bases ni tableros existentes.
set -euo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$AQUI/verificar-proyectos.mjs" flutter "$@"
