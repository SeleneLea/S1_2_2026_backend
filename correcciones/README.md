# Correcciones pendientes del generador

Esta carpeta describe, con detalle suficiente para implementarlas sin haber participado en
la conversación original, siete correcciones al generador de proyectos (Spring Boot + Flutter)
que vive en `src/generators/`.

Cada archivo es independiente y tiene la misma estructura:

1. **Síntoma** — qué le pasa a la persona que usa el diagramador.
2. **Cómo reproducirlo** — pasos exactos.
3. **Causa** — archivo, línea y el código actual que provoca el defecto.
4. **Qué hacer** — los cambios concretos, con el código propuesto.
5. **Criterio de aceptación** — cómo se comprueba que quedó arreglado.
6. **Riesgos y qué no tocar.**

Todos los hallazgos fueron verificados leyendo el código de este repositorio el 21/09/2026.
Donde una afirmación no se pudo comprobar ejecutando, está dicho explícitamente.

La [01](01-colision-de-nombres.md) además está **comprobada ejecutando**: se exportó el
diagrama `correcciones/pruebas/diagramas/nombres-conflictivos.json` y el proyecto resultante da
`BUILD FAILURE` con 132 errores, y su app Flutter no pasa `flutter analyze`. Los scripts que lo
hacen están en [pruebas/](pruebas/README.md).

## Orden recomendado

| # | Corrección | Por qué en este orden | Tamaño |
|---|---|---|---|
| [01](01-colision-de-nombres.md) | Colisión de nombres con las clases generadas | Es el único que deja un proyecto que **no compila** | mediano |
| [03](03-vaciar-relaciones.md) | No se pueden vaciar relaciones ni borrar valores opcionales | Pérdida silenciosa de datos del usuario | pequeño |
| [05](05-sesion-y-esperas-flutter.md) | Sesión vencida y peticiones sin tiempo máximo en Flutter | Barato y se nota de inmediato al usar la app | pequeño |
| [02](02-permisos-del-backend.md) | Registro público con roles de gestión, cuentas demo y secreto de firma | Hueco real de permisos, pero no rompe el prototipo | mediano |
| [07](07-pruebas-automaticas.md) | Batería automática de exportaciones | Evita que 01 y 03 vuelvan a pasar inadvertidos | mediano |
| [04](04-validaciones-por-dominio.md) | Validaciones tomadas del modelo UML | Es el cambio más amplio (editor + parser + 2 generadores) | grande |
| [06](06-listados-grandes.md) | Paginación, búsqueda y filtros | Con datos de demostración no molesta | grande |

Las correcciones 01, 02, 03 y 05 son defectos. Las 04 y 06 son mejoras de diseño: el código
actual hace lo que dice, pero la decisión que tomó no sirve para cualquier dominio.

## Cómo está armada la generación (mapa rápido)

Entrada: el tablero guardado en Postgres (tabla `"Salas"`, columna con el diagrama en JSON).

```
POST /apis/crearPagina/exportarSpringBoot/:id
  src/controllers/crearPagina.controller.clean.js
    · lee el tablero y normaliza nodos y conexiones
    · processedAttributes  (línea ~90)  -> forma de cada atributo
    · derivarClavesForaneas             -> agrega los atributos FK
    · alinearClavesDeHerencia           -> la clave del hijo toma el tipo del padre
    · llama a SpringBootProjectBuilder
  src/generators/SpringBootProjectBuilder.js   <- orquestador, método build()
    DiagramParser        -> entidades y relaciones limpias
    MetadataBuilder      -> qué getters/setters existirán realmente
    EntityGenerator, ManyToManyEntityGenerator, DTOGenerator, MapperGenerator,
    RepositoryGenerator, ServiceGenerator, ControllerGenerator,
    AuthGenerator, AsistenteGenerator, SeedGenerator, ReadmeGenerator, SqlDDLGenerator

POST /apis/crearPagina/exportarFlutter/:id
  src/controllers/flutterExport.controller.js
  src/generators/FlutterProjectBuilder.js      <- orquestador
    FlutterNombres (nombres y claves JSON compartidos), FlutterModelGenerator,
    FlutterServiceGenerator, FlutterScreenGenerator, FlutterAuthGenerator,
    FlutterAsistenteGenerator, FlutterMainGenerator
```

Dos reglas que se repiten y conviene tener presentes:

- **Los nombres se comparten entre los dos generadores.** La ruta REST la calculan tres
  archivos por separado (`ControllerGenerator.toKebabCase`, `FlutterServiceGenerator.toKebabCase`
  y `ReadmeGenerator`); si se cambia una, hay que cambiar las tres o el Flutter pega a una
  ruta que no existe. Ya pasó con las tildes (`/api/vídeo` contra `/api/video`).
- **`MetadataBuilder` decide si un getter existe.** Varios generadores consultan
  `metadata.get(Entidad).entity.getters` antes de emitir una llamada; si se agregan campos
  nuevos hay que agregarlos también ahí o el generador los salta con un `console.warn`.

## Reglas del repositorio

- **Idioma:** todo el código nuevo, comentarios y mensajes en español, con tildes. Los
  identificadores que ya existen en inglés se dejan como están (no hay que renombrar
  `updateEntityFields` "de paso").
- **Commits:** mensaje descriptivo en español, sin `Co-Authored-By:` ni líneas de atribución
  de ninguna herramienta, sin `--force`.
- **Secretos:** `backend/.env` no se imprime nunca. Para usar sus valores:
  `set -a; . .env; set +a` y después `$DB_PASSWORD`, `$DB_USER`, `$DB_PORT` sin hacer `echo`.
  Ninguna clave ni token se escribe en archivos del repositorio.
- **Nada de `node_modules` ni `temp/` en los commits.**

## Cómo levantar y probar

```bash
# diagramador local (puerto 8083)
cd software-1---parcial2/backend && npm start
```

Usuarios de prueba del diagramador: `prueba1@gmail.com` / `prueba2@gmail.com`, clave `12345678`.
Al arrancar con la base vacía siembra 5 tableros de ejemplo (ids 27 a 31 en la instalación
usada para estas pruebas): tienda, biblioteca, clínica, académico y bancario.

Los scripts de `correcciones/pruebas/` exportan esos tableros, levantan cada backend contra su
propia base y corren `flutter analyze` en cada app. Ver [07](07-pruebas-automaticas.md).

### Trampas de este entorno (Windows)

- Maven y Gradle fallan con `Unable to establish loopback connection` o `Selector.open`
  si no se les da un temporal corto: exportar `TMP='C:\tmpjava'` y `TEMP='C:\tmpjava'`.
- Antes de compilar una app Flutter generada hay que crear las plataformas:
  `flutter create . --platforms android,web`.
- Si un `DROP DATABASE` dice que la base está en uso, el backend generado sigue vivo:
  `netstat -ano | grep :PUERTO` y `taskkill //PID <pid> //F`.

## Estado

Nada de esta carpeta está implementado todavía. Al terminar cada corrección, marcarla en la
tabla de arriba y dejar dicho en el commit qué criterio de aceptación se comprobó.
