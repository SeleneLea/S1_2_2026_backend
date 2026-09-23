# 06 · Listados y selectores que descargan toda la tabla

**Gravedad: baja con datos de demostración, alta con datos de verdad.**
**Tamaño: grande.** Hacerlo al final: con tres registros sembrados no se nota, y los cambios
tocan el contrato de la API, así que conviene que 01, 02, 03 y 05 ya estén estables.
**Archivos a tocar:** `src/generators/ControllerGenerator.js`,
`src/generators/ServiceGenerator.js`, `src/generators/RepositoryGenerator.js`,
`src/generators/FlutterServiceGenerator.js`, `src/generators/FlutterScreenGenerator.js`.

## Síntoma

- Abrir la lista de una entidad descarga **todos** los registros de esa tabla en una sola
  petición y los arma todos en memoria.
- Abrir un formulario con tres relaciones descarga **las tres tablas completas** para llenar los
  desplegables. Con 20.000 clientes, el formulario tarda o se queda sin memoria.
- No hay buscador ni filtro: para encontrar un registro hay que desplazarse.

## Causa

Backend, `ControllerGenerator.js:106-122`:

```java
@GetMapping
public ResponseEntity<Map<String, Object>> getAll() {
    List<${entity.name}> entities = service.findAll();
    List<${entity.name}DTO> dtos = mapper.toDTOList(entities);
    response.put("data", dtos);
    response.put("total", dtos.size());
    ...
}
```

Flutter, `FlutterServiceGenerator.js:48-51` y `:34-40`:

```dart
  Future<List<Producto>> getAll() async {
    return aLista(await getData(ruta), Producto.fromJson);
  }

  /// Opciones para elegir Categoria en el formulario
  Future<List<Categoria>> getCategoriaOptions() async {
    return aLista(await getData('/categoria'), Categoria.fromJson);
  }
```

Y las pantallas las consumen de una vez: `_registros = _service.getAll()` en `initState`
(`FlutterScreenGenerator.js:198-205`) dentro de un `FutureBuilder` (`:261`), y
`_cargarOpciones()` (`:386`) que llama a un `get<Ref>Options()` por cada relación.

Lo que **ya está** y se puede aprovechar:

- Los repositorios extienden `JpaRepository`, así que `findAll(Pageable)` existe sin escribir
  nada (`RepositoryGenerator.js`).
- Ya se generan búsquedas por campo y por FK: `findBy<Campo>`, `existsBy<Campo>` y
  `findBy<FK>Id` para los tres primeros atributos y para cada FK
  (`ServiceGenerator.js:156-200`, `RepositoryGenerator.js:92-127`).
- Ya existe `atributoDescriptivo` (`FlutterNombres.js`), que elige el campo que representa a un
  registro (`nombre`, `titulo`, `descripcion`, `codigo`… y si no, el primer `String`). Es el que
  debe usar el buscador.

## Qué hacer

### Paso 1 — paginar sin romper lo que ya funciona

Que el endpoint siga respondiendo lo mismo cuando no se le pide página. Así el README, la app
generada antes del cambio y la batería de pruebas siguen valiendo:

```java
/**
 * GET /api/producto
 * Sin parámetros devuelve todos los registros (como antes).
 * Con ?pagina=0&tamano=20 devuelve esa página; ?buscar=texto filtra; ?orden=nombre,asc ordena.
 */
@GetMapping
public ResponseEntity<Map<String, Object>> getAll(
        @RequestParam(required = false) Integer pagina,
        @RequestParam(required = false) Integer tamano,
        @RequestParam(required = false) String buscar,
        @RequestParam(required = false) String orden) {
```

Respuesta cuando viene `pagina`, agregando claves **sin quitar** las que ya existen
(`success`, `data`, `total`, `message`):

```json
{ "success": true, "data": [...], "total": 1234,
  "pagina": 0, "tamano": 20, "paginas": 62, "hayMas": true,
  "message": "Registros obtenidos exitosamente" }
```

`total` pasa a ser el total de la tabla (no el de la página) cuando se pagina; hoy es el largo
de `data` y coincide. Dejarlo dicho en el README del proyecto generado, porque la batería de
pruebas usa `total` para comprobar que no hay listas vacías.

Tope de seguridad: `tamano` mayor que 200 se recorta a 200.

### Paso 2 — búsqueda

Dos caminos; elegir uno y no mezclarlos:

**(a) Recomendado: `JpaSpecificationExecutor`.** El repositorio pasa a
`extends JpaRepository<X, Long>, JpaSpecificationExecutor<X>` y el servicio arma la condición:

```java
/** Busca el texto en los campos de texto del registro; sin texto no filtra nada. */
private Specification<Producto> porTexto(String texto) {
    if (texto == null || texto.isBlank()) return null;
    String patron = "%" + texto.trim().toLowerCase() + "%";
    return (raiz, consulta, cb) -> cb.or(
        cb.like(cb.lower(raiz.get("nombre")), patron),
        cb.like(cb.lower(raiz.get("descripcion")), patron)
    );
}
```

Los campos los elige el generador: los atributos `String` de la entidad (los mismos que hoy
alimentan `findBy<Campo>`), más el que devuelve `atributoDescriptivo`. **Importante:** para las
entidades con herencia hay que incluir los campos del padre, igual que hace
`generateActualizarHeredados`; si se referencia un campo que no está en la entidad, el
`Specification` falla en tiempo de ejecución, no al compilar.

**(b) Más simple: `@Query` en el repositorio** con un `LIKE` por campo. Menos flexible para
combinar con los filtros por FK, pero no agrega interfaces.

### Paso 3 — filtros por relación

Con el `Specification` ya armado, agregar un `@RequestParam` por cada FK de la entidad:
`?clienteId=3`. El generador ya sabe cuáles son (usa la misma lista que
`generateFKResolutionLogic`). Sin Specification, reutilizar el `findBy<FK>Id` que ya existe.

### Paso 4 — ordenar

`?orden=nombre,asc`. Validar el campo contra la lista de atributos de la entidad y **rechazar
lo que no esté** (400): pasar el texto directo a `Sort.by` permite ordenar por cualquier
propiedad, y con un nombre inventado revienta con un 500 feo.

Orden por defecto: la clave primaria descendente, para que lo último cargado aparezca primero.
Hoy el orden es el que devuelve la base, que no está definido.

### Paso 5 — Flutter: lista con páginas

En `FlutterServiceGenerator`, cambiar `getAll()` por un método que devuelva la página y su
información, dejando `getAll()` como atajo de la primera página para no romper nada:

```dart
  /// Una página de registros. [buscar] filtra por texto; [pagina] empieza en 0.
  Future<Pagina<Producto>> getPagina({int pagina = 0, int tamano = 20, String? buscar}) async {
    final consulta = <String, String>{'pagina': '$pagina', 'tamano': '$tamano'};
    if (buscar != null && buscar.trim().isNotEmpty) consulta['buscar'] = buscar.trim();
    return Pagina.desde(await getRespuesta(ruta, consulta), Producto.fromJson);
  }
```

Eso pide dos cosas en `base_service.dart`:

1. Un `getRespuesta(ruta, consulta)` que devuelva **el sobre completo** y no solo `data`
   (hoy `_enviar` desempaqueta `data`, `FlutterServiceGenerator.js:141`), porque la app necesita
   `paginas` y `hayMas`.
2. Una clase `Pagina<T>` con `items`, `total`, `pagina`, `hayMas` y un `Pagina.desde(...)`.

En `FlutterScreenGenerator`, la pantalla de lista pasa de `FutureBuilder` a estado propio:

- `TextField` de búsqueda arriba, con espera de ~400 ms antes de consultar (si no, una petición
  por tecla). Un `Timer` que se cancela en cada cambio; cancelarlo también en `dispose()` o
  `flutter analyze` avisa de la fuga.
- `ScrollController` que, al llegar cerca del final y con `hayMas`, pide la página siguiente.
- Al guardar o borrar, volver a la página 0 con el texto de búsqueda puesto.
- Estado vacío distinto según el caso: "todavía no hay registros" y "no hay resultados para
  «texto»" no son lo mismo.

### Paso 6 — selectores de relación que no bajan la tabla entera

Este es el cambio que más se nota en un sistema real. Por cada relación:

```dart
  /// Opciones para elegir Cliente. Con [buscar] pide al backend solo lo que coincide.
  Future<List<Cliente>> getClienteOptions({String? buscar, int tamano = 20}) async { ... }
```

En el formulario, en lugar del `DropdownButtonFormField` de siempre
(`FlutterScreenGenerator.js:608-630`), usar `Autocomplete` / `DropdownMenu` con búsqueda contra
el servidor cuando la tabla referida puede ser grande.

Criterio sencillo para no cambiar el comportamiento donde no hace falta: pedir la primera
página (20) y, si `hayMas` es `true`, mostrar el control con búsqueda; si cabe entera, el
desplegable de hoy. Así los prototipos de la defensa siguen viéndose igual.

Cuidado con dos detalles que ya están resueltos en el código actual y hay que conservar:

- Al editar, el valor ya elegido tiene que aparecer aunque no esté en la primera página: pedir
  ese registro por id (`getById`) y agregarlo a las opciones.
- El `ValueKey('${c.nombre}-${_opcionesX.length}')` (`:610`) existe porque el desplegable no
  se refresca solo cuando llegan las opciones. Si se cambia el control, comprobar que el valor
  seleccionado siga mostrándose.

### Paso 7 — etiquetas, campos visibles y orden del formulario

Esta parte de la observación original es de presentación y se puede resolver con la misma
notación entre llaves de [04](04-validaciones-por-dominio.md), sin tocar el editor:

```
- nombreCompleto: String {etiqueta="Nombre del cliente"}
- claveInterna: String {oculto}
- fechaAlta: Date {orden=1}
- descripcion: String {principal}      <- el campo que representa al registro
```

- `etiqueta` reemplaza a `etiquetaCampo()` (`FlutterNombres.js`), que hoy convierte
  `nombreCompleto` en "Nombre completo".
- `oculto` saca el campo de la lista y del formulario, pero **no** de la entidad ni del DTO.
- `orden` cambia el orden de los campos del formulario; los que no lo declaren van después, en
  el orden del diagrama.
- `principal` reemplaza la heurística de `atributoDescriptivo` (`nombre`, `titulo`,
  `descripcion`, `codigo`, y si no el primer `String`), que acierta casi siempre pero no
  siempre.

Estas cuatro son solo de Flutter; no cambian nada del backend.

## Criterio de aceptación

1. Diagrama de prueba con una entidad y 5.000 registros sembrados (agregar un modo al
   sembrador o cargarlos con un `INSERT` masivo).
2. `GET /api/x` sin parámetros → sigue devolviendo todo (compatibilidad).
3. `GET /api/x?pagina=0&tamano=20` → 20 registros, y `total`, `paginas`, `hayMas` correctos.
4. `GET /api/x?buscar=ana` → solo los que contienen "ana", sin distinguir mayúsculas.
5. `GET /api/x?orden=inventado,asc` → 400 con un mensaje entendible (no un 500).
6. `GET /api/x?clienteId=3` → solo los de ese cliente.
7. En la app: la lista carga las primeras 20, al desplazarse pide más, y el buscador filtra
   sin una petición por tecla (comprobarlo con `read_network_requests` o el log del backend).
8. El formulario con una relación de 5.000 registros abre sin descargarlos todos.
9. `flutter analyze` → `No issues found!` en los cinco tableros.
10. La batería de [07](07-pruebas-automaticas.md) sigue verde, incluido el conteo de `total`.

## Riesgos y qué no tocar

- **Compatibilidad del endpoint.** Si `GET /api/x` sin parámetros deja de devolver la lista
  completa, se rompen el README generado, la app anterior y los scripts de prueba. Mantener el
  comportamiento por defecto.
- **`Specification` y herencia.** Los tableros `academico` y `bancario` tienen herencia; los
  campos del buscador tienen que resolverse en la clase correcta o falla al ejecutar.
- **No meter paginación en el asistente** (`/api/asistente`): no lista registros.
- No adelantarse a esta corrección antes de la 03: las dos tocan `ServiceGenerator` y es más
  fácil resolver el conflicto si la 03 ya está.
