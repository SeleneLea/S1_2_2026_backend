# 07 · Batería automática de exportaciones

**Gravedad: no es un defecto del producto, es lo que hace que los defectos aparezcan.**
**Estado: medio hecho.** Los tres scripts ya están en `correcciones/pruebas/` y funcionan;
lo que falta son los diagramas de casos difíciles y una prueba de punta a punta.
**Archivos a tocar:** `correcciones/pruebas/*`, y al final mover lo que quede estable a
`package.json` como script de npm.

## El problema

Que los archivos se generen no demuestra que funcionen juntos. Es exactamente lo que pasó con
la corrección [01](01-colision-de-nombres.md): los cinco tableros de ejemplo se exportan,
compilan, arrancan, siembran y pasan `flutter analyze` — y sin embargo un diagrama con una
clase `Usuario` produce un proyecto que no compila. **Ninguno de los cinco tableros tiene una
clase llamada `Usuario`**, así que el caso nunca se probó.

Al revés también: revisar el código encuentra cosas que ejecutar no encuentra, y ejecutar
encuentra cosas que leer no encuentra. La batería cubre la segunda mitad.

## Lo que ya existe

Tres scripts, probados el 21/09/2026 contra los cinco tableros de ejemplo:

| Script | Qué hace |
|---|---|
| `pruebas/exportar.sh` | Inicia sesión en el diagramador local, busca el tablero por título (o carga un diagrama de `pruebas/diagramas/`), pide las dos exportaciones y descomprime |
| `pruebas/probar-backends.sh` | Base limpia por tema, arranca el backend, comprueba arranque, siembra, todos los endpoints, crear sin id, 401 sin sesión, rechazo del rol de consulta y vaciado de un muchos a muchos |
| `pruebas/analizar-flutter.sh` | `flutter create . --platforms android`, `flutter pub get` y `flutter analyze` por app |

Uso:

```bash
cd software-1---parcial2/backend && npm start          # en otra consola, puerto 8083
cd correcciones/pruebas
./exportar.sh && ./probar-backends.sh && ./analizar-flutter.sh
```

Los proyectos quedan en `backend/temp/pruebas/<tema>/{spring,flutter}` (`temp/` está en
`.gitignore`). Los dos últimos scripts terminan con código de salida distinto de cero si algo
falla, así que se pueden encadenar con `&&`.

Resultado de esa corrida, para tener una línea de partida:

| tema | clases sembradas | endpoints | crear sin id | sin sesión | rol de consulta | flutter analyze |
|---|---|---|---|---|---|---|
| tienda | 4 | 4 · 0 errores · 0 vacíos | 201 | 401 | (un solo rol) | OK · 11 pantallas |
| biblioteca | 5 | 5 · 0 errores · 0 vacíos | 201 | 401 | (un solo rol) | OK · 13 pantallas |
| clínica | 8 + relación M:N | 8 · 0 errores · 0 vacíos | 201 | 401 | PACIENTE rechazado | OK · 19 pantallas |
| académico | 9 (con herencia) | 9 · 0 errores · 0 vacíos | 201 | 401 | PERSONA rechazado | OK · 21 pantallas |
| bancario | 15 (con herencia) | 15 · 0 errores · 0 vacíos | 201 | 401 | CLIENTE rechazado | OK · 33 pantallas |

La comprobación de vaciado de relaciones es nueva y **hoy falla a propósito**: es la que
verifica la corrección [03](03-vaciar-relaciones.md).

Los scripts también se corrieron con el diagrama de nombres conflictivos, y ahí sirvieron para
lo que están hechos:

```
$ ./exportar.sh nombres-conflictivos
nombres-conflictivos   tablero 32 · spring 200 (72 KB) · flutter 200 (36 KB)

$ ./mvnw -B -ntp compile        # en temp/pruebas/nombres-conflictivos/spring
BUILD FAILURE · 132 errores en 9 archivos

$ ./analizar-flutter.sh nombres-conflictivos
nombres-conflictivos   PROBLEMAS:  (7 errores de analyze)
```

O sea: el generador **exporta sin quejarse** un proyecto que no compila. Eso es lo que hay que
volver imposible, y por eso la corrección [01](01-colision-de-nombres.md) incluye avisar antes
de exportar además de apartar los nombres.

## Qué falta

### Paso 1 — diagramas de casos difíciles

Ya están tres en `pruebas/diagramas/`, en el mismo formato que guarda el editor
(`{"nodes":[...],"edges":[...]}`, con los atributos como texto `"nombre: string"`):

| Archivo | Para qué | Corrección |
|---|---|---|
| `nombres-conflictivos.json` | clases `Usuario`, `Asistente`, `Auth`, `Base` | [01](01-colision-de-nombres.md) |
| `relaciones-opcionales.json` | dos muchos a muchos y una FK opcional (`0..1`) | [03](03-vaciar-relaciones.md) |
| `validaciones.json` | `{0..1}`, `{min=-50, max=80}`, `{unico, 1..20}` | [04](04-validaciones-por-dominio.md) |

Faltan dos más:

- `herencia-profunda.json`: tres niveles (`Persona` → `Empleado` → `Gerente`), con atributos
  obligatorios en el abuelo. Es el caso que rompió la siembra en `academico` y `bancario`.
- `fechas-y-horas.json`: `Date`, fecha con hora, y un campo `hora` como texto, que es de donde
  salió el `"hora": "Hora 1"` que había que arreglar.

Para escribir uno nuevo, el molde más fiel es un tablero real:

```bash
psql -d diagrama_dev -t -A -c 'SELECT xml FROM "Salas" WHERE id = 27;' > molde.json
```

`exportar.sh` los carga solo: `./exportar.sh nombres-conflictivos` inserta el diagrama como
tablero `PRUEBA nombres-conflictivos` (reemplazando el anterior), lo exporta y lo descomprime.

### Paso 2 — compilar el backend, no solo arrancarlo

`probar-backends.sh` arranca con `spring-boot:run`, que compila; pero si falla, el mensaje se
pierde entre los del arranque. Agregar un paso previo explícito:

```bash
( cd "$proyecto" && ./mvnw -B -ntp -q compile ) || { echo "  ✖ NO COMPILA"; ... }
```

Es lo que convierte la corrección 01 en una prueba que falla claramente en lugar de un
"NO ARRANCO" ambiguo.

### Paso 3 — una operación real entre las dos partes

Hoy el backend se prueba con `curl` y la app solo con `flutter analyze`: nadie comprueba que la
app **hable** con el backend. Lo mínimo que cierra el círculo, con el backend del tema ya
levantado:

```bash
cd "$SALIDA/$tema/flutter"
flutter create . --platforms web
flutter build web --dart-define=API_URL=http://localhost:$puerto/api
python -m http.server 8099 --directory build/web &
```

y desde el panel de navegador: iniciar sesión con `<rol>@demo.com` / `12345678`, abrir una
lista, crear un registro, editarlo dejando una relación vacía y comprobar con `curl` que el
backend lo guardó así. Es el único paso que no se puede dejar completamente automático sin
meter `integration_test` y un emulador; conviene dejarlo como guion escrito y hacerlo a mano
antes de cada entrega.

Si más adelante se quiere automatizar de verdad: `flutter drive` con
`package:integration_test` sobre Chrome headless, y el backend levantado en el mismo script.
No hace falta emulador.

### Paso 4 — dejarlo a mano en `package.json`

```json
"scripts": {
  "pruebas:exportar": "bash correcciones/pruebas/exportar.sh",
  "pruebas:backend":  "bash correcciones/pruebas/probar-backends.sh",
  "pruebas:flutter":  "bash correcciones/pruebas/analizar-flutter.sh",
  "pruebas":          "npm run pruebas:exportar && npm run pruebas:backend && npm run pruebas:flutter"
}
```

### Paso 5 — qué NO automatizar todavía

- **El teléfono físico.** La instalación por USB depende de que la pantalla esté desbloqueada
  (en MIUI, `INSTALL_FAILED_USER_RESTRICTED` con la pantalla apagada) y de que el usuario
  acepte. La versión web cubre lo mismo sin intervención.
- **El asistente con Gemini o DeepSeek.** Depende de internet y de claves; ya existe
  `/api/asistente/estado` para comprobar que el endpoint está, y con eso alcanza.
- **Render.** El despliegue lo dispara el usuario desde su panel; la batería es local.

## Criterio de aceptación

1. `./exportar.sh && ./probar-backends.sh && ./analizar-flutter.sh` termina con código 0 sobre
   los cinco temas de ejemplo.
2. `./exportar.sh nombres-conflictivos && ./probar-backends.sh nombres-conflictivos` **falla
   hoy** (compila mal) y **pasa** cuando esté hecha la corrección 01.
3. Lo mismo para `relaciones-opcionales` con la corrección 03 y `validaciones` con la 04.
4. Los scripts no dejan procesos vivos: después de correrlos, `netstat -ano | grep -E ':809[0-9]'`
   no muestra nada escuchando.
5. Ningún script imprime valores de `.env`.

## Riesgos y qué no tocar

- **Los ids de los tableros cambian entre instalaciones.** Por eso `exportar.sh` los busca por
  título y no por número; si se cambian los títulos de los tableros de ejemplo, hay que
  actualizar el arreglo `TITULOS` del script.
- **Las bases `prueba_<tema>` se borran y se crean en cada corrida.** No poner nada valioso
  ahí. Y si un `DROP DATABASE` dice que está en uso, quedó un backend vivo de una corrida
  anterior: `netstat -ano | grep :PUERTO` y `taskkill //PID <pid> //F`.
- **El diagramador tiene que estar corriendo con el código actual.** Si se edita un generador
  y no se reinicia `npm start`, se exporta con el código viejo en memoria y las pruebas mienten.
  Ya pasó una vez. Vale la pena que `exportar.sh` avise comparando algo del código con lo
  generado, o simplemente reiniciar siempre antes de exportar.
