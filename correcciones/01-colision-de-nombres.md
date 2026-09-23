# 01 · Colisión de nombres entre el diagrama y las clases generadas

**Gravedad: alta.** Es la única de la lista que produce un proyecto que no compila.
**Archivos a tocar:** `src/generators/SpringBootProjectBuilder.js`,
`src/generators/AuthGenerator.js`, `src/generators/FlutterProjectBuilder.js`,
y un módulo nuevo `src/generators/NombresReservados.js`.

## Síntoma

Si el diagrama tiene una clase llamada `Usuario`, el proyecto Spring Boot exportado no
compila. La entidad `Usuario` del diagrama desaparece —con todos sus atributos— y en su
lugar queda la entidad de inicio de sesión, que tiene otros campos. El DTO, el mapper, el
servicio y el controlador ya se habían generado a partir de la clase del diagrama, así que
siguen llamando a getters que la entidad sobrescrita no tiene:

```
UsuarioMapper.java:[..] error: cannot find symbol
    dto.setCodigoNegocio(entity.getCodigoNegocio());
                               ^  symbol: method getCodigoNegocio()
```

Lo mismo ocurre, con otras clases, en los nombres de la lista de abajo. En Flutter el efecto
equivalente es que `flutter analyze` falla porque una pantalla importa un servicio que ya no
tiene los métodos que usa.

## Cómo reproducirlo

El diagrama de prueba ya está en el repositorio:
`correcciones/pruebas/diagramas/nombres-conflictivos.json` (clases `Usuario` con
`codigoNegocio`, `Asistente`, `Auth`, `Base` y `Empleado`).

```bash
cd software-1---parcial2/backend && npm start          # en otra consola, puerto 8083
cd correcciones/pruebas && ./exportar.sh nombres-conflictivos
cd ../../temp/pruebas/nombres-conflictivos/spring
TMP='C:\tmpjava' TEMP='C:\tmpjava' ./mvnw -B -ntp compile
```

**Ejecutado el 21/09/2026: `BUILD FAILURE`, 132 errores de compilación en 9 archivos.**

```
services/AuthServiceImpl.java:[23,41] interface expected here
services/AsistenteServiceImpl.java:[22,46] interface expected here
mappers/UsuarioMapper.java:[25,31] incompatible types: java.lang.Long cannot be converted to java.lang.Integer
mappers/UsuarioMapper.java:[27,36] cannot find symbol        (entity.getCodigoNegocio())
```

Reparto de los errores: `AuthServiceImpl` 36, `AsistenteServiceImpl` 36, `UsuarioServiceImpl`
24, `UsuarioMapper` 10, `AuthMapper` 6, `AsistenteMapper` 6, `DatosDemo` 6, `entities/Auth` 4,
`entities/Asistente` 4.

Vale la pena mirar los tres tipos de error, porque son tres choques distintos:

- **`interface expected here`**: la clase `AuthService` de la sesión pisó la *interfaz*
  `AuthService` del CRUD de la entidad `Auth`, y `AuthServiceImpl` dice
  `implements AuthService`. Lo mismo con `Asistente`.
- **`cannot find symbol`**: `UsuarioMapper` llama a `entity.getCodigoNegocio()` sobre la entidad
  de sesión, que no tiene ese campo.
- **`Long` contra `Integer`**: el `id: int` del diagrama genera `Integer`, y la entidad de
  sesión usa `Long`.

En Flutter, el mismo diagrama:

```bash
cd correcciones/pruebas && ./analizar-flutter.sh nombres-conflictivos
```

**Ejecutado: `flutter analyze` con errores.** Aquí el choque va al revés y es peor, porque la
entidad `Base` pisó `base_service.dart`, que es donde viven `BaseService` y `ApiException`:

```
error - The method 'getUsuarioOptions' isn't defined for the type 'AsistenteService'
          lib\screens\asistente_form_screen.dart:51:46
error - A value of type 'Future<List<Base>>' can't be assigned to a variable of type 'Future<List<Asistente>>'
          lib\screens\asistente_list_screen.dart:22:18
error - The name 'ApiException' isn't a type and can't be used in an on-catch clause
          lib\screens\asistente_screen.dart:86:10
```

## Causa

`SpringBootProjectBuilder.build()` (`src/generators/SpringBootProjectBuilder.js:71-86`)
genera primero lo del diagrama y **después** lo de la infraestructura:

```js
this.generateEntities();        // 72  -> entities/Usuario.java (la del diagrama)
this.generateRepositories();    // 76
this.generateServices();        // 77
this.generateControllers();     // 78
this.generateConfigClasses();   // 79
this.generateAutenticacion();   // 80  -> entities/Usuario.java (la de la sesión) PISA la anterior
this.generateAsistente();       // 81
this.generateDatosDemo();       // 82
```

Y `generateAutenticacion()` (`src/generators/SpringBootProjectBuilder.js:94-111`) escribe sin
preguntar si el archivo ya existía:

```js
const archivos = [
    ['entities/Usuario.java', entidadUsuario()],
    ['repositories/UsuarioRepository.java', repositorioUsuario()],
    ['services/AuthService.java', servicioAuth(roles)],
    ['controllers/AuthController.java', controladorAuth()],
    ['config/AuthFiltro.java', filtroAuth()],
];
for (const [relativo, contenido] of archivos) {
    const destino = path.join(base, relativo);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);   // <-- pisa lo que hubiera
}
```

Hay un segundo choque, en la base de datos: `EntityGenerator` pone
`@Table(name = toSnakeCase(entity.name))` (`src/generators/EntityGenerator.js:288-294`), o sea
que la clase `Usuario` del diagrama pide la tabla `usuario`, y la entidad de sesión declara
`@Table(name = "usuario", uniqueConstraints = @UniqueConstraint(columnNames = "correo"))`
(`src/generators/AuthGenerator.js:50`). Aunque las clases Java se llamaran distinto, las dos
querrían la misma tabla. **Por eso no alcanza con renombrar la clase: hay que renombrar la
tabla también.**

### Nombres reservados que hoy pisan al diagrama

Spring Boot (`com.example.demo`):

| Archivo generado | Clase del diagrama que lo pisa | Dónde se escribe |
|---|---|---|
| `entities/Usuario.java` | `Usuario` | SpringBootProjectBuilder.js:98 |
| `repositories/UsuarioRepository.java` | `Usuario` | :99 |
| `services/AuthService.java` | `Auth` | :100 |
| `controllers/AuthController.java` | `Auth` | :101 |
| `config/AuthFiltro.java` | — | :102 |
| `services/AsistenteService.java` | `Asistente` | :124 |
| `controllers/AsistenteController.java` | `Asistente` | :128 |
| `config/DatosDemo.java` | `DatosDemo` | :147 |
| `config/CorsConfig.java` | `Cors` | :590 |
| `config/WebConfig.java` | `Web` | :614 |
| `config/JacksonConfig.java` | `Jackson` | :1141 |
| `config/EntityIdDeserializer.java` | `EntityIdDeserializer` | :1292 |
| `config/ServidorWebConfig.java` | — | :734 |
| `exceptions/GlobalExceptionHandler.java` | — | :715 |
| `exceptions/RecursoNoEncontradoException.java` | — | :718 |
| `DemoApplication.java` | `Demo` | :791 |

Los casos realistas son `Usuario` y `Asistente`; el resto entra por completitud.

Flutter (`FlutterProjectBuilder.js`), donde el orden es el contrario y **la entidad pisa a la
infraestructura**, porque los servicios de las entidades se escriben en la línea 98 y los
generados después:

| Archivo generado | Clase del diagrama | Quién gana hoy |
|---|---|---|
| `lib/services/base_service.dart` (:93) | `Base` | la entidad (se pierde `BaseService`) |
| `lib/services/asistente_service.dart` (:114) | `Asistente` | el asistente (se pierde el servicio de la entidad) |
| `lib/services/auth_service.dart` (:128) | `Auth` | la sesión |
| `lib/screens/asistente_screen.dart` (:119) | — | — |
| `lib/screens/login_screen.dart` (:133) | — | — |
| `lib/screens/home_screen.dart` (:142) | — | — |

Las pantallas de entidad son `<base>_list_screen.dart` y `<base>_form_screen.dart`, así que
una clase `Home` o `Login` **no** choca. El modelo `lib/models/usuario.dart` tampoco choca.

## Qué hacer

### Paso 1 — módulo nuevo `src/generators/NombresReservados.js`

```js
/**
 * Nombres que usan las clases y archivos que el generador agrega por su cuenta
 * (inicio de sesión, asistente, datos de ejemplo, configuración). Si el diagrama
 * trae una clase con uno de estos nombres, hay que apartar el generado: antes se
 * pisaban entre sí y el proyecto no compilaba.
 */
const SIN_TILDES = (texto) => String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Compara nombres de clase como lo hace el sistema de archivos: sin tildes y sin mayúsculas. */
export const mismoNombre = (a, b) =>
    SIN_TILDES(a).toLowerCase() === SIN_TILDES(b).toLowerCase();

/** true si alguna clase del diagrama se llama así. */
export const estaOcupado = (nombre, entidades = []) =>
    entidades.some((e) => mismoNombre(e.name, nombre));

/**
 * Devuelve el nombre pedido, o el nombre con sufijo si el diagrama ya lo usa.
 * Se prueban varios sufijos por si el diagrama también tiene "UsuarioAcceso".
 */
export const nombreLibre = (base, entidades = [], sufijos = ['Acceso', 'Interno', 'Generado']) => {
    if (!estaOcupado(base, entidades)) return base;
    for (const sufijo of sufijos) {
        if (!estaOcupado(base + sufijo, entidades)) return base + sufijo;
    }
    let n = 2;
    while (estaOcupado(`${base}${n}`, entidades)) n += 1;
    return `${base}${n}`;
};

/** snake_case para el nombre de tabla, igual que EntityGenerator.toSnakeCase. */
export const aSnake = (nombre) => SIN_TILDES(nombre)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
```

Comprobar que `aSnake` dé el mismo resultado que `EntityGenerator.toSnakeCase` para
`Usuario`, `ClienteNatural`, `Vídeo`; si difiere, importar la de `EntityGenerator` en vez de
duplicarla.

### Paso 2 — que `AuthGenerator` reciba el nombre de la clase de cuentas

Hoy las cinco funciones no toman parámetros de nombre. Cambiar a:

```js
export const entidadUsuario = (clase = 'Usuario', tabla = 'usuario') => `...`;
export const repositorioUsuario = (clase = 'Usuario') => `...`;
export const servicioAuth = (roles, clase = 'Usuario') => `...`;
export const controladorAuth = (clase = 'Usuario') => `...`;
export const filtroAuth = () => `...`;   // no menciona la clase, se queda igual
```

Dentro de esas plantillas hay que reemplazar cada aparición literal por la variable:

- `public class Usuario {` → `public class ${clase} {`
- `@Table(name = "usuario", ...)` → `@Table(name = "${tabla}", ...)`
- `interface UsuarioRepository extends JpaRepository<Usuario, Long>` →
  `interface ${clase}Repository extends JpaRepository<${clase}, Long>`
- en `servicioAuth` y `controladorAuth`: los `import com.example.demo.entities.Usuario;`,
  `import com.example.demo.repositories.UsuarioRepository;`, el tipo de `repository`, los
  `Usuario usuario = new Usuario();`, `Optional<Usuario>`, `public Usuario registrar(...)`.

Buscar con `grep -n "Usuario" src/generators/AuthGenerator.js` y no dejar ninguna literal
fuera; son del orden de 20 apariciones.

### Paso 3 — el builder decide el nombre una vez y lo reparte

En `SpringBootProjectBuilder.generateAutenticacion()`:

```js
import { nombreLibre, aSnake } from './NombresReservados.js';

generateAutenticacion() {
    const roles = detectarRoles(this.entidadesConcretas);
    this.rolesDelSistema = roles;
    // Si el diagrama ya tiene una clase Usuario, la cuenta de acceso se llama distinto:
    // antes se pisaban y el proyecto no compilaba.
    this.claseCuenta = nombreLibre('Usuario', this.parsedDiagram.entities);
    this.tablaCuenta = aSnake(this.claseCuenta);
    const base = path.join(this.projectPath, 'src/main/java/com/example/demo');
    const archivos = [
        [`entities/${this.claseCuenta}.java`, entidadUsuario(this.claseCuenta, this.tablaCuenta)],
        [`repositories/${this.claseCuenta}Repository.java`, repositorioUsuario(this.claseCuenta)],
        ['services/AuthService.java', servicioAuth(roles, this.claseCuenta)],
        ['controllers/AuthController.java', controladorAuth(this.claseCuenta)],
        ['config/AuthFiltro.java', filtroAuth()],
    ];
    ...
}
```

`this.parsedDiagram.entities` incluye las abstractas y auxiliares: hay que usar esa lista, no
`entidadesConcretas`, porque una interfaz llamada `Usuario` también genera archivo.

Ojo con el orden: `generateAutenticacion()` corre en la línea 80 y `generateDatosDemo()` en la
82, así que `this.claseCuenta` ya está disponible para el sembrador. Si algún día se
adelanta la siembra, calcular el nombre en `build()` antes de todo.

### Paso 4 — mismo trato para `AsistenteService`/`AsistenteController` y `DatosDemo`

```js
this.claseAsistente = nombreLibre('Asistente', this.parsedDiagram.entities); // -> AsistenteInterno
this.claseDatosDemo = nombreLibre('DatosDemo', this.parsedDiagram.entities);
```

`AsistenteGenerator.servicioAsistente()` y `controladorAsistente()` deben aceptar el nombre
igual que el paso 2. El endpoint REST `/api/asistente` **no cambia** (la app Flutter y el
README lo usan); lo que cambia es el nombre de la clase Java.

### Paso 5 — en Flutter, apartar el archivo de la entidad, no el de la infraestructura

En Flutter la infraestructura es la que el usuario no ve, pero el servicio de la entidad sí
se usa desde las pantallas, así que conviene lo contrario que en Spring: dejar que la
infraestructura conserve su nombre (`base_service.dart`, `auth_service.dart`,
`asistente_service.dart`) y darle otro al archivo de la entidad.

En `FlutterProjectBuilder.generateServices()`, y en la función que arma los nombres
(`archivoDart` de `src/generators/FlutterNombres.js`), agregar:

```js
// Archivos que genera la app por su cuenta: si una entidad se llama así, su
// servicio se guarda con sufijo para no pisarlos.
const ARCHIVOS_PROPIOS = new Set(['base_service', 'auth_service', 'asistente_service']);

export const archivoServicio = (nombreEntidad) => {
    const base = `${archivoDart(nombreEntidad)}_service`;
    return ARCHIVOS_PROPIOS.has(base) ? `${archivoDart(nombreEntidad)}_api_service` : base;
};
```

Y usarla en los dos lugares que hoy construyen ese nombre: el `writeFile` de
`FlutterProjectBuilder.js:98` y el `import` que emite `FlutterScreenGenerator` para cada
pantalla. Si quedan desalineados, `flutter analyze` falla con
`Target of URI doesn't exist`, así que el criterio de aceptación lo detecta.

La clase Dart (`AsistenteService` contra el `AsistenteService` de la entidad) también choca:
usar `nombreLibre` para la clase del servicio de la entidad, o prefijarla con `Api`.

### Paso 6 — red de seguridad: no pisar archivos en silencio

Agregar un helper en los dos builders y usarlo en lugar de `fs.writeFileSync` /
`fs.writeFile` para todo lo que se genere:

```js
/**
 * Escribe un archivo nuevo. Si ya existía, es que dos generadores eligieron el
 * mismo nombre: se avisa fuerte en lugar de perder el contenido anterior.
 */
escribirNuevo(ruta, contenido) {
    if (fs.existsSync(ruta)) {
        throw new Error(
            `Dos partes del generador quieren escribir ${path.basename(ruta)}. ` +
            `Renombra la clase del diagrama o agrega el nombre a NombresReservados.js.`
        );
    }
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, contenido);
}
```

Este helper es el que hace que la corrección no se pueda deshacer sin darse cuenta.
**Excepción:** `application.properties` se escribe una vez y luego se le agregan bloques con
`fs.appendFileSync`; eso sigue igual.

### Paso 7 — avisar a quien exporta

Cuando `nombreLibre` devuelva algo distinto del nombre base, juntar los cambios en
`this.avisos = []` y:

- imprimirlos en consola con `console.warn`;
- agregarlos al README del proyecto generado (`ReadmeGenerator`), en una sección
  "Nombres que se cambiaron al generar", explicando que la clase `Usuario` del diagrama se
  conservó y que la cuenta de acceso se llama `UsuarioAcceso` y usa la tabla `usuario_acceso`.

## Criterio de aceptación

1. Diagrama de prueba nuevo, `correcciones/pruebas/diagramas/nombres-conflictivos.json`, con
   clases `Usuario` (con `codigoNegocio: String`), `Asistente`, `Auth` y `Base`, más una
   relación entre dos de ellas.
2. Exportar a Spring Boot y compilar: `./mvnw -B -ntp compile` termina en `BUILD SUCCESS`.
3. En el proyecto generado, `entities/Usuario.java` es la clase **del diagrama** y tiene
   `codigoNegocio`. La cuenta de acceso está en `entities/UsuarioAcceso.java` con
   `@Table(name = "usuario_acceso")`.
4. Levantar el backend: arranca, siembra, y `POST /api/auth/login` con
   `<rol>@demo.com` / `12345678` devuelve un token.
5. `GET /api/usuario` con ese token responde 200 y trae `codigoNegocio`.
6. Exportar a Flutter el mismo diagrama, `flutter create . --platforms android` + `flutter pub get`
   + `flutter analyze` → `No issues found!`.
7. Los cinco tableros de ejemplo (tienda, biblioteca, clínica, académico, bancario) siguen
   pasando la batería de [07](07-pruebas-automaticas.md) sin cambios de comportamiento: sus
   clases no se llaman así, por lo que los nombres generados no deben cambiar.

El punto 7 es el que evita romper lo que ya funciona: si después de este cambio alguno de los
cinco exporta una clase `UsuarioAcceso`, la detección de ocupado está mal.

## Riesgos y qué no tocar

- **No renombrar la clase del diagrama.** El usuario dibujó `Usuario` a propósito; lo que se
  aparta es lo que agrega el generador.
- **No cambiar las rutas REST.** `/api/auth/*` y `/api/asistente` los usa la app Flutter
  generada y el README; solo cambian nombres de clases y de tabla.
- `MetadataBuilder` no conoce la entidad de cuentas (no sale del diagrama) y no hace falta que
  la conozca: ningún mapper ni servicio del diagrama la usa.
- Al renombrar la tabla, revisar `SqlDDLGenerator`: si emite el `CREATE TABLE` de la cuenta de
  acceso, tiene que usar el mismo nombre nuevo. Si no la emite (la crea Hibernate con
  `ddl-auto`), no hay nada que hacer ahí.
