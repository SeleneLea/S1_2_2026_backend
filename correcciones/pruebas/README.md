# Pruebas de los proyectos generados

Los comandos usan Node y funcionan en PowerShell, Git Bash y Linux. La exportación y las
regresiones no necesitan diagramador, consultas PostgreSQL ni llamadas a IA.

Última validación, 22/09/2026: 19 regresiones Node, 12 proyectos Spring/API con 68 CRUD,
12 análisis Flutter y 79 pruebas Flutter aprobados. También pasaron contrato HTTP real,
bootstrap administrativo y actualización de una tabla antigua de cuentas. Corrida y
alcance completo en [RESULTADOS.md](RESULTADOS.md).

Desde `backend/`:

```text
npm test
npm run pruebas:generar
npm run pruebas:backend
npm run pruebas:flutter
npm run pruebas:integracion
```

- `npm test`: ejecuta diecinueve regresiones, genera doce casos y comprueba nombres, permisos, PUT/PATCH (incluidas colecciones
  omitidas), restricciones, sesión, herencia y fechas. Inspecciona el código generado; no
  reemplaza compilación ni pruebas de API.
- `pruebas:generar`: usa los cinco `TABLEROS_PRUEBA` y todos los JSON de `diagramas/`.
  Convierte los nodos mediante el mismo controlador de producción, sin servidor ni consultas.
- `pruebas:backend`: ejecuta una compilación Maven explícita de cada exportación.
- `pruebas:flutter`: prepara web, obtiene dependencias y ejecuta `flutter analyze` y `flutter test`.
- `pruebas:integracion`: compila y empaqueta; crea una base única por caso y arranca su JAR.
  Comprueba siembra, endpoints, sesión, permisos, alta de cuentas, rechazo de gestores en
  registro público, paginación, PUT/PATCH, opcionales, rangos y unicidad. Detiene solo su Java.
- `pruebas:contrato`: ejecuta Flutter contra el Spring de relaciones-opcionales: sesión,
  creación, paginación, vaciado de relaciones, consulta y borrado. No requiere emulador.
- `pruebas:bootstrap`: arranca permisos sin cuentas demo en otra base nueva y comprueba
  que la cuenta inicial es ADMIN y puede administrar. Usa `AUTH_INICIAL_*` de prueba.
- `pruebas`: regresiones, generación, compilación y análisis; `pruebas:completas` añade API
  y el contrato Flutter real, seguido de bootstrap. También puede usarse `pruebas:integracion -- --con-flutter`.

Cada corrida crea una carpeta nueva en `backend/temp/pruebas-local/`. Conserva las anteriores.
`manifest.json` enumera las rutas absolutas. Ante un fallo, la generación devuelve código 1
y registra el error; los verificadores rechazan corridas incompletas. Sus registros quedan
en `logs/`. No se imprimen contraseñas, tokens ni contenido de `.env`.

Para un caso:

```text
npm run pruebas:generar -- nombres-conflictivos
npm run pruebas:backend -- nombres-conflictivos
npm run pruebas:flutter -- nombres-conflictivos
```

Los verificadores eligen el manifest más reciente; para fijarlo:

```text
npm run pruebas:backend -- --manifest "temp/pruebas-local/CORRIDA/manifest.json" tienda
npm run pruebas:integracion -- --manifest "temp/pruebas-local/CORRIDA/manifest.json" relaciones-opcionales validaciones
```

Los `.sh` son lanzadores del harness Node. No usan `rm -rf`, no borran tableros del
diagramador ni cierran procesos por número de puerto.

## Requisitos

Node y las dependencias de backend para generar; Java/Maven wrapper para compilar; Flutter
para analizar. La primera compilación puede descargar dependencias. En Linux, el harness
invoca el wrapper mediante `sh`; no necesita cambiar sus permisos.

La integración usa exclusivamente `DB_HOST`, `DB_PORT`, `DB_USER` y `DB_PASSWORD` locales
de `backend/.env`; exige permiso para crear bases. Ignora `DATABASE_URL`.
Las bases `prueba_gen_<timestamp>_<aleatorio>` se conservan para inspección.
`spring/integracion.json` registra la base y el puerto; `integracion.log` guarda el arranque.
No se borran bases existentes ni se terminan sesiones PostgreSQL ajenas.

En Windows, si existe `C:\tmpjava`, se reutiliza como temporal corto. Si hace falta otro,
configurar `TEMP` y `TMP` antes de ejecutar. No se crean carpetas fuera del repo.

## Casos difíciles

| Caso | Riesgo |
| --- | --- |
| nombres-conflictivos | Usuario/Auth/Asistente/Base sin pisar infraestructura ni tablas |
| relaciones-opcionales | Dos M:N, FK opcional, PUT vacío y PATCH omitido |
| validaciones | Opcionales, números negativos acotados, longitud y unicidad |
| herencia-profunda | Tres niveles y atributos obligatorios en el abuelo |
| fechas-y-horas | Fecha, fecha/hora, hora como texto y LocalTime |
| permisos | Módulos y registros propios/asignados, identidad vinculada, cascadas y aislamiento entre cuentas |
| permisos-mn | Edición desde el lado inverso de M:N, rollback, lectura compartida y escritura restringida |

El fixture `permisos` añade pruebas de API con dos clientes y dos entrenadores, caminos
de pertenencia de varios pasos, count/exists, relaciones, registro y vínculos administrativos.
El modo Flutter añade cuatro pruebas de widgets/sesión y tres pruebas con un servidor HTTP
local: 401 concurrentes, cierre durante una respuesta tardía y recuperación de rol revocado.
Se suman a las seis pruebas de sesión incluidas en la app generada.
`permisos-mn` añade la prueba de asociaciones inversas entre Plan y Objetivo, con el dueño
accesible solo para lectura: crear, agregar/quitar, omitir, revertir un cambio rechazado,
evitar duplicados al paginar y borrar sin dejar enlaces en la tabla intermedia.

```text
npm run pruebas:generar -- permisos
npm run pruebas:integracion -- permisos
npm run pruebas:flutter -- permisos
```

El contrato HTTP Flutter → Spring se prueba automáticamente con `pruebas:contrato`.
La interacción de las pantallas se verifica siguiendo [E2E-web.md](E2E-web.md).
Teléfonos físicos, proveedores de IA y despliegues siguen fuera de esta batería local.
