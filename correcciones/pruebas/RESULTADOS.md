# Resultados de las correcciones del generador

## Actualización 08 · 22 de septiembre de 2026

El catálogo persistente contiene ahora doce diagramas: los cinco tableros de ejemplo,
los cinco fixtures de 01–07, `permisos` y `permisos-mn`. Las regresiones Node son 19.

Corrida final:
`temp/pruebas-local/generacion-2026-09-22T04-45-00-895Z-4BwL8A`.
Su `manifest.json` fija los doce proyectos. Todos los comandos finalizaron con código 0.

| Comprobación final | Resultado |
| --- | --- |
| Regresiones Node (`npm test`) | 19/19 aprobadas, incluida la comprobación puntual posterior de sombreado |
| Compilación y empaquetado Spring Boot | 12/12 proyectos aprobados |
| Inicio, siembra e integración con PostgreSQL | 12/12 proyectos; 68 endpoints CRUD comprobados |
| Flutter analyze | 12/12 aplicaciones sin incidencias |
| Flutter test | 79/79: 11 aplicaciones con 6 y permisos con 13 |
| Contrato real Flutter → Spring | Aprobado en relaciones-opcionales |
| Consultas con 5.000 productos | Paginación, búsqueda, conteo, orden y rechazo de offset excesivo aprobados |
| Bootstrap con `AUTH_DEMO=false` | ADMIN inicial, acceso a cuentas/API y demo rechazado |
| Cierre de Java | Cero procesos de esta corrida después de las pruebas |
| Sintaxis JS/MJS y espacios del diff | `node --check` y `git diff --check` aprobados |

Las 79 pruebas Flutter incluyen cuatro de widgets/actualización de sesión y tres con HTTP
local real específicas de permisos. El contrato contra Spring se ejecuta por separado.
Los logs de la corrida y los archivos `spring/integracion.json` conservan las bases aisladas
y los resultados; `permisos/spring/bootstrap.json` y `bootstrap.log` registran el bootstrap.

La prueba de permisos verificó los vínculos históricos sin acreditar, su revalidación
administrativa y su revocación. La variante M:N inversa aprobó sus 29 aserciones: alta y
cambios desde Plan con Objetivo solo de lectura, sincronización del lado propietario,
PATCH omitido, rechazo de vínculos ajenos con rollback, ausencia de altas huérfanas,
paginación sin duplicados, lectura compartida y escritura compartida denegada.

También pasaron estas comprobaciones adicionales:

- FK de pertenencia heredada en tres niveles: `Registro` abstracto → `Entrada` abstracta →
  `Plan`, con camino `objetivo.notaVenta.entrenador`. Compilación/empaquetado y 18 aserciones
  de API de alta, PUT, PATCH, borrado, alcance y rollback. Referencia: `temp/revision08-herencia.json`.
- Actualización de una tabla de cuentas antigua: empieza con un CLIENTE y una referencia
  histórica, sin columna de verificación. El JAR final agrega `vinculo_verificado=false`,
  conserva rol/referencia y crea un ADMIN separado al recibir credenciales iniciales.
  Login, cuentas y API funcionan; el demo permanece desactivado. Script temporal:
  `temp/revision08-bootstrap-migracion.mjs`; evidencia en
  `permisos/spring/bootstrap-migracion.json` y `bootstrap-migracion.log`, base aislada
  `prueba_gen_1790052632689_a45fbd74`. Código 0 y ningún Java de la corrida restante.
- Colisión de nombres de permisos: una entidad `Autorizacion`, una FK y un atributo
  llamados `autorizacion` conviven con los helpers. También se incluyen entidades
  `SesionActual`, `VinculosCuenta` y `AccesoDenegadoException`. Se corrigió el uso del
  campo del servicio a `this.autorizacion` para que un argumento no lo oculte. La
  compilación mínima y las 19 regresiones Node pasaron. Referencia:
  `temp/revision08-colision.json`, corrida `revision08-colision-2026-09-22T04-53-40-534Z-H6t6ZW`.
  Esta cualificación puntual se validó después de la batería completa de doce proyectos;
  no se volvió a ejecutar toda la integración por ese cambio.

Como evidencia intermedia se conserva
`temp/pruebas-local/generacion-2026-09-22T04-38-39-448Z-d6zmR7`: sus once diagramas pasaron
Spring, API de 63 CRUD, Flutter y contrato real. La primera comprobación M:N está en
`temp/revision08-mn-editable.json`; después quedó incorporada a la batería final de doce.

Decisiones y límites de 08:

- Los módulos denegados no devuelven fichas; un DTO permitido puede conservar IDs de sus
  relaciones. Acceder a la ficha relacionada exige su permiso y alcance.
- Leer un registro compartido admite alguna pertenencia; escribir exige todas las
  pertenencias dentro del alcance. ADMIN conserva acceso global.
- Una cuenta con referencia histórica sin `vinculoVerificado` no obtiene alcance hasta
  que administración confirme su vínculo. Los cambios se aplican a tokens ya emitidos.
- Los widgets se probaron automáticamente; no se hizo una instalación nueva en un teléfono
  físico ni una comprobación visual completa del `gym` del usuario.
- Los resultados de 01–07 que siguen son evidencia histórica de la corrida anterior.

## Correcciones 01–07 · 21 de septiembre de 2026

Validación local del 21 de septiembre de 2026 (America/La_Paz). La marca de tiempo UTC
de la corrida final corresponde al 22 de septiembre.

Corrida: `temp/pruebas-local/generacion-2026-09-22T03-27-35-221Z-WYQ69E`.
Su `manifest.json` identifica las salidas de Spring Boot y Flutter; los registros de
compilación, análisis y pruebas se conservan en `logs/` dentro de esa misma carpeta.

Revalidación final, la misma noche local:
`temp/pruebas-local/generacion-2026-09-22T03-32-02-469Z-aRaCsP`
(relaciones-opcionales, con los últimos ajustes del harness y de paginación).

## Estado de la ejecución

| Comprobación | Resultado |
| --- | --- |
| Regresiones Node sobre diez diagramas y caso decimal (`npm test`) | 11/11 aprobadas |
| Compilación y empaquetado Spring Boot | 10/10 proyectos aprobados |
| Inicio, siembra y API con PostgreSQL | 10/10 proyectos; 58 endpoints CRUD comprobados |
| Flutter analyze | 10/10 aplicaciones sin incidencias |
| Flutter test | 60/60 pruebas aprobadas; 6 por aplicación |
| Contrato real Flutter → Spring | Aprobado en relaciones-opcionales |
| Consultas con 5.000 productos | Paginación, búsqueda, conteo y orden aprobados |
| Proyecto adicional con clases abstractas | Maven, API de 2 CRUD, Flutter analyze y 6/6 pruebas aprobados |
| Revalidación de offset extremo y cierre de procesos Java | Aprobada: HTTP 400 para offset excesivo y 0 procesos Java de esa corrida |

Se comprobaron once modelos con compilación y ejecución: los diez de la batería persistente
y uno adicional con clases abstractas. Las 66 pruebas Flutter indicadas no incluyen la prueba separada
del contrato HTTP real. La validación distingue generación, compilación y ejecución.

Durante la corrida se detectó que el launcher Java de Oracle en Windows dejaba un proceso
hijo vivo al cerrar únicamente su PID. El harness se corrigió para esperar el cierre de
su árbol propio con `taskkill /T /F`. La nueva exportación pasó integración con Flutter real,
análisis y pruebas Flutter, todos con código 0. Se comprobó el rechazo de un offset fuera
de rango y se verificó con los procesos de Windows que no quedaron Java de esa corrida.
Los diez procesos hijos de la corrida anterior se cerraron tras verificar que sus líneas
de comando apuntaban exactamente a su carpeta; se confirmó que no quedó ninguno de esa
corrida. El proceso de la batería terminó con código 0.

## Alcance

Se generan los cinco tableros de ejemplo (tienda, biblioteca, clínica, académico y bancario)
y cinco casos difíciles: nombres conflictivos, relaciones opcionales, validaciones,
herencia profunda y fechas/horas.

La batería comprueba:

- Conservación de entidades del dominio y separación de clases, tablas, rutas y servicios
  de infraestructura; los proyectos con Usuario, Auth, Asistente y Base deben compilar.
- Registro público sin roles de gestión, administración de cuentas protegida, rechazo
  de peticiones sin sesión y de escritura de usuarios de consulta. Se incluye acceso
  a cuentas con parámetros de matriz y un backend con context-path.
- Creación de registros sin enviar ID; PUT que vacía M:N o elimina una FK opcional;
  PATCH que conserva relaciones omitidas y acepta una lista vacía explícita.
- Validaciones compartidas: campos opcionales, rangos que admiten números negativos,
  límites de longitud y restricciones únicas; siembra en herencia de tres niveles.
  Se incluye una regresión de siembra decimal única en el rango 0.001–0.025.
- Paginación, conteo, búsqueda y orden sobre 5.000 productos añadidos a una base exclusiva
  de prueba; rechazo de parámetros inválidos.
- Recuperación de sesión Flutter con vencimiento local, peticiones con plazo y manejo
  centralizado de 401; análisis estático y pruebas de la aplicación generada.
- Llamadas reales de los servicios y modelos Flutter al Spring temporal: inicio de sesión,
  creación, paginación, vaciado de relaciones, consulta y borrado, sin emulador.

Los scripts de integración crean bases con nombres únicos y conservan su identificación
en `spring/integracion.json`. No consultan ni modifican las tablas del diagramador. El JAR
iniciado por la prueba se detiene al finalizar.

## Comprobación adicional

Comprobación adicional fuera de los diez fixtures persistentes: una jerarquía
`RegistroBase` abstracta → `PersonaIntermedia` abstracta → `Especialista` concreta,
con una FK heredada hacia Departamento (PK de texto), y una clase abstracta aislada.
La exportación de revisión compiló y se empaquetó (39 archivos Java), pasó arranque,
siembra, sesión/permisos y paginación en sus dos CRUD; Flutter pasó analyze y 6 pruebas.
Artefacto local: `temp/revision-abstracta-1790047530247`. Esta comprobación no añade un
undécimo fixture a la batería persistente.

También se comprobó una exportación Flutter con un atributo oculto: su análisis terminó
sin incidencias. Esta comprobación adicional de interfaz no se suma a los once modelos
con validación completa de backend y app.

## Límites de esta validación

- Las regresiones Node inspeccionan el código emitido; la ejecución Java y Flutter se
  comprueba con las etapas separadas de la batería.
- El contrato Flutter → Spring usa servicios y modelos reales, sin interactuar con botones
  y formularios en un navegador. La comprobación visual queda en [E2E-web.md](E2E-web.md).
- No se verifican instalación en un teléfono físico, compilación Android/iOS, proveedores
  externos de IA ni despliegues remotos.
- Las llamadas de exportación HTTP del diagramador no forman parte de esta corrida local;
  se utiliza su conversor de diagramas y los mismos constructores de proyectos.
- El caso de 5.000 registros valida el comportamiento de consultas; no es una medición
  de capacidad ni una prueba de concurrencia de producción.
- El modelo bancario todavía emite siete avisos: se omiten endpoints auxiliares de navegación
  por FK heredadas porque su metadata no enumera esos getters. Los campos heredados sí están
  presentes y funcionan en DTO, mapper y CRUD, según la revisión. Completar esos endpoints
  auxiliares queda como mejora fuera de las siete correcciones.
- Los resultados corresponden a estos diez diagramas; no garantizan cualquier combinación
  posible de nombres, atributos y relaciones UML.

Para repetir la batería y elegir la misma corrida, consultar [README.md](README.md).
