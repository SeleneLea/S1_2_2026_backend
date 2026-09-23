# 02 · Permisos del backend generado: registro público, cuentas demo y secreto de firma

**Gravedad: la primera parte es alta (cualquiera se da permisos de gestión); las otras dos son
configuración por defecto que conviene endurecer.**
**Archivos a tocar:** `src/generators/AuthGenerator.js`, `src/generators/ReadmeGenerator.js`.

Son tres cosas distintas y conviene no mezclarlas: **(A)** el registro público deja elegir
cualquier rol, incluidos los que escriben; **(B)** las cuentas de demostración se crean solas;
**(C)** el secreto de firma tiene un valor por defecto igual en todos los proyectos generados.

(A) es un hueco de permisos y hay que cerrarlo. (B) es una conveniencia deliberada del
generador de prototipos —las cuentas `<rol>@demo.com` son lo que permite entrar a la app recién
exportada— y lo que le falta es un interruptor y un aviso, no desaparecer. (C) se arregla
generando un secreto distinto por proyecto.

---

## A · Cualquiera se registra con un rol de gestión

### Síntoma

En un proyecto generado a partir de un diagrama con `Paciente` y `Médico`, cualquiera que
alcance la API puede crear una cuenta con rol `MEDICO` y a partir de ahí crear, editar y
borrar todos los datos del sistema.

### Cómo reproducirlo

```bash
curl -s -X POST http://localhost:8093/api/auth/registro \
  -H 'Content-Type: application/json' \
  -d '{"correo":"cualquiera@ejemplo.com","clave":"12345678","rol":"MEDICO","nombre":"X"}'
```

Responde 201 con un token, y ese token pasa el control de escritura del filtro.

### Causa

Dos piezas que se suman:

1. `AuthFiltro.shouldNotFilter` (`src/generators/AuthGenerator.js:437-442`) deja pasar sin
   token **todo** lo que empiece con `/api/auth`:

   ```java
   return !activa
           || "OPTIONS".equalsIgnoreCase(peticion.getMethod())
           || ruta.startsWith("/api/auth")
           || ruta.equals("/api/asistente/estado")
           || !ruta.startsWith("/api");
   ```

2. `AuthService.registrar` (`src/generators/AuthGenerator.js:196-211`) acepta cualquier rol de
   la lista, y `ROLES` incluye a los gestores:

   ```java
   String rolLimpio = rol == null ? "" : rol.trim().toUpperCase();
   if (!ROLES.contains(rolLimpio)) throw new IllegalArgumentException("El rol debe ser uno de: " + ROLES);
   ```

El control de escritura del filtro (`:459-468`) está bien hecho —exige rol de gestión para
POST/PUT/PATCH/DELETE— pero no sirve de nada si cualquiera puede darse ese rol.

### Qué hacer

**1. Separar los roles que se pueden pedir en el registro público.** En `servicioAuth`, junto a
`rolesGestores`:

```java
/**
 * Roles que alguien puede elegir al crear su propia cuenta. Los roles de gestión no
 * están aquí: los asigna quien administra, desde POST /api/cuentas.
 */
@Value("\${app.auth.roles-registro-publico:${roles.filter((r) => !r.gestor).map((r) => r.rol).join(',')}}")
private String rolesRegistroPublico;

public List<String> rolesQueSeRegistran() {
    return Arrays.stream(rolesRegistroPublico.split(","))
            .map(String::trim).filter(s -> !s.isEmpty()).toList();
}
```

**2. Dividir `registrar` en dos métodos.** El público valida contra la lista nueva; el de
administración acepta cualquier rol conocido:

```java
/** Alta pública: solo los roles que no gestionan datos. */
public Usuario registrar(String correo, String clave, String rol, String nombre, String referenciaId) {
    String rolLimpio = rol == null ? "" : rol.trim().toUpperCase();
    List<String> permitidos = rolesQueSeRegistran();
    if (permitidos.isEmpty()) {
        throw new IllegalArgumentException(
                "En este sistema las cuentas las crea quien administra. Pide que te den acceso.");
    }
    if (!permitidos.contains(rolLimpio)) {
        throw new IllegalArgumentException("Al crear tu cuenta puedes elegir: " + permitidos);
    }
    return crearCuenta(correo, clave, rolLimpio, nombre, referenciaId);
}

/** Alta hecha por alguien con rol de gestión: puede asignar cualquier rol del sistema. */
public Usuario crearCuenta(String correo, String clave, String rol, String nombre, String referenciaId) {
    // aquí va tal cual el cuerpo que hoy tiene registrar(): validación de correo,
    // largo de clave, ROLES.contains(rol), existsByCorreoIgnoreCase y save()
}
```

**3. Endpoint de administración fuera de `/api/auth`.** Importante: tiene que quedar **fuera**
de `/api/auth` para que el filtro lo proteja. Como el filtro ya exige rol de gestión para todo
POST, no hay que agregar ninguna comprobación extra:

```java
// en un controlador nuevo, @RequestMapping("/api/cuentas")
@PostMapping
public ResponseEntity<Map<String, Object>> crear(@RequestBody Map<String, String> cuerpo) {
    // el filtro ya garantizó sesión válida y rol de gestión
    Usuario usuario = service.crearCuenta(cuerpo.get("correo"), cuerpo.get("clave"),
            cuerpo.get("rol"), cuerpo.get("nombre"), cuerpo.get("referenciaId"));
    ...
}
```

Conviene agregar también `GET /api/cuentas` (lista de correos y roles, **sin** el campo
`clave`) y `PUT /api/cuentas/{id}/rol`, porque si no, no hay forma de nombrar al primer gestor
salvo las cuentas demo.

**4. `GET /api/auth/roles` debe decir cuáles se pueden pedir.** Hoy devuelve `roles` y
`gestores`; agregar `registroPublico`:

```java
respuesta.put("data", Map.of(
        "roles", AuthService.ROLES,
        "gestores", service.rolesQueGestionan(),
        "registroPublico", service.rolesQueSeRegistran()));
```

**5. Flutter: que el selector de rol del registro muestre solo esos.** En
`src/generators/FlutterAuthGenerator.js`, el método `roles()` lee `data['roles']`; cambiarlo a
`data['registroPublico']` con `data['roles']` como respaldo si la clave no viene (un backend
generado antes de este cambio). Si la lista llega vacía, esconder la pestaña de registro y
mostrar "las cuentas las crea quien administra".

**6. Afinar la lista de rutas públicas del filtro**, para que un endpoint nuevo bajo
`/api/auth` no quede abierto por accidente:

```java
private static final List<String> LIBRES =
        List.of("/api/auth/login", "/api/auth/registro", "/api/auth/roles", "/api/asistente/estado");

@Override
protected boolean shouldNotFilter(HttpServletRequest peticion) {
    String ruta = peticion.getRequestURI();
    return !activa
            || "OPTIONS".equalsIgnoreCase(peticion.getMethod())
            || LIBRES.contains(ruta)
            || !ruta.startsWith("/api");
}
```

Cuidado: `/api/auth/yo` deja de ser libre. Revisar que el controlador siga funcionando con el
token que ahora valida el filtro (debería: lee la cabecera igual).

**7. Propiedades.** En `propiedadesAuth`, agregar con comentario:

```
# Roles que alguien puede elegir al crear su propia cuenta (los de gestión NO van aquí).
# Vacío = nadie se registra solo; las cuentas las crea un rol de gestión en POST /api/cuentas.
app.auth.roles-registro-publico=<roles no gestores separados por coma>
```

**Caso borde:** si el diagrama tiene una sola clase de persona, `detectarRoles` la marca como
gestora (`AuthGenerator.js:35-36`) y entonces la lista de registro público queda **vacía**: en
ese proyecto nadie puede registrarse solo y solo se entra con las cuentas demo. Es el
comportamiento correcto, pero hay que decirlo en el README generado, porque si no parece que el
registro está roto. Pasa con los tableros de ejemplo `tienda` (solo `CLIENTE`) y `biblioteca`
(solo `SOCIO`), así que el README del proyecto tiene que explicarlo.

### Criterio de aceptación

1. Exportar el tablero `clinica` y levantarlo.
2. `POST /api/auth/registro` con `"rol":"MEDICO"` → **400** con el mensaje de qué roles se
   pueden elegir.
3. `POST /api/auth/registro` con `"rol":"PACIENTE"` → 201 y token.
4. Con el token de `paciente@demo.com`, `POST /api/cuentas` → **403** (lo corta el filtro).
5. Con el token de `medico@demo.com`, `POST /api/cuentas` con `"rol":"MEDICO"` → 201.
6. En la app Flutter, el desplegable de rol del registro muestra solo `PACIENTE`.
7. Los cinco tableros de la batería de [07](07-pruebas-automaticas.md) siguen pasando; en
   `tienda` y `biblioteca` el registro público queda cerrado y el README lo explica.

---

## B · Las cuentas de demostración se crean solas

### Situación

`AuthService.preparar()` (`src/generators/AuthGenerator.js:165-182`) crea una cuenta por rol
cuando la tabla está vacía, con la clave `12345678`, y la imprime en consola:

```java
if (cuentasDemo && repository.count() == 0) {
    for (String rol : ROLES) { ... u.setClave(protegerClave(claveDemo)); ... }
    System.out.println("Cuentas de prueba creadas: " + ... + " con la clave " + claveDemo);
}
```

Con `app.auth.cuentas-demo=true` y `app.auth.clave-demo=12345678` en
`application.properties`.

**Esto es a propósito** y no hay que quitarlo: es lo que permite abrir la app recién exportada
y entrar sin configurar nada, y es lo que se usa para mostrar el prototipo. El problema es solo
que no hay manera de apagarlo sin editar el archivo, y que un proyecto subido a un servidor
queda con cuentas conocidas.

### Qué hacer

1. Que el interruptor se pueda cambiar desde el entorno, igual que ya se hace con el secreto:

   ```
   # Cuentas de prueba al arrancar con la base vacía: <rol>@demo.com con la clave de abajo.
   # Sirven para probar el prototipo. En un servidor de verdad: AUTH_DEMO=false
   app.auth.cuentas-demo=${AUTH_DEMO:true}
   app.auth.clave-demo=${AUTH_DEMO_CLAVE:12345678}
   ```

2. Aviso claro al arrancar, para que no pase inadvertido en un despliegue:

   ```java
   System.out.println("⚠️  Cuentas de prueba activas (app.auth.cuentas-demo=true). " +
           "En un servidor de verdad arranca con AUTH_DEMO=false.");
   ```

3. Sección en el README del proyecto generado (`ReadmeGenerator`): "Antes de publicar esto":
   `AUTH_DEMO=false`, `AUTH_SECRET=<frase propia>`, y crear el primer gestor con
   `POST /api/cuentas`.

No cambiar el valor por defecto a `false`: rompería el arranque del prototipo, que es el caso
de uso principal. Que el aviso y el README dejen la decisión en claro es suficiente.

---

## C · El secreto de firma es el mismo en todos los proyectos generados

### Situación

Dos valores por defecto, los dos públicos porque están en este repositorio:

- `propiedadesAuth` (`src/generators/AuthGenerator.js:492`) escribe
  `app.auth.secreto=${AUTH_SECRET:cambia-esta-frase-por-una-larga-y-secreta}`.
- Si la propiedad llega vacía, `preparar()` (`:167-169`) usa
  `"clave-de-firma-por-defecto-cambiala-en-produccion"`.

Como el token es `base64url(json) + "." + base64url(HmacSHA256(json))`
(`AuthGenerator.js:225-236, 255-263`), quien conozca el secreto se fabrica un token con
`"rol":"MEDICO"` y la firma da válida. El `AUTH_SECRET` del entorno lo arregla, pero solo si
alguien se acuerda de ponerlo.

### Qué hacer

1. **Un secreto distinto por proyecto exportado.** En `propiedadesAuth`, generar un valor
   aleatorio en el momento de generar:

   ```js
   import { randomBytes } from 'crypto';
   // Cada proyecto exportado lleva su propia frase de firma: antes todos compartían
   // la misma y con ella se puede falsificar una sesión.
   const secretoNuevo = randomBytes(48).toString('base64url');
   ```

   ```
   # Firma de las sesiones. Se generó una propia para este proyecto.
   # Para cambiarla sin editar este archivo: variable de entorno AUTH_SECRET.
   app.auth.secreto=${AUTH_SECRET:<secretoNuevo>}
   ```

2. **Quitar el valor fijo de respaldo en Java.** Si la propiedad llega vacía, generar uno
   aleatorio en memoria y avisar que las sesiones se caen al reiniciar; eso es molesto pero no
   inseguro, mientras un valor conocido sí lo es:

   ```java
   if (secretoConfigurado == null || secretoConfigurado.isBlank()) {
       byte[] aleatorio = new byte[48];
       azar.nextBytes(aleatorio);
       secreto = aleatorio;
       System.out.println("⚠️  Sin app.auth.secreto: se usó una frase aleatoria. " +
               "Las sesiones se cerrarán al reiniciar. Define AUTH_SECRET.");
   } else {
       secreto = secretoConfigurado.getBytes(StandardCharsets.UTF_8);
   }
   ```

3. Anotar en el README generado que `application.properties` trae un secreto propio y que **no
   hay que publicarlo** en un repositorio público; que use `AUTH_SECRET`.

### Criterio de aceptación

1. Exportar el mismo tablero dos veces: los `app.auth.secreto` de los dos
   `application.properties` son distintos y no son la frase de este repositorio.
2. Un token emitido por la primera copia es rechazado por la segunda (401).
3. Arrancar con `-Dapp.auth.secreto=` (vacío): arranca, imprime el aviso, y el login funciona
   mientras el proceso viva.
4. La batería de [07](07-pruebas-automaticas.md) sigue verde: login, 401 sin sesión y 403 para
   el rol de consulta.

## Riesgos y qué no tocar

- **No tocar PBKDF2 ni el formato del token.** El hash de claves (`protegerClave`, `derivar`) y
  el formato `cuerpo.firma` funcionan y la app Flutter ya los entiende.
- **No agregar Spring Security.** El filtro propio es deliberado: el proyecto generado tiene que
  compilar y arrancar sin configuración extra, y `AuthFiltro` ya cubre sesión y permiso de
  escritura.
- No borrar `app.auth.activa=false`: es el interruptor que permite probar la API sin sesión
  mientras se desarrolla.
