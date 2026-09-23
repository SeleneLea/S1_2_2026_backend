# 04 · Las validaciones no salen del modelo, están fijas en el generador

**Gravedad: media.** No rompe nada, pero hay dominios que no se pueden representar.
**Tamaño: el más grande de la lista.** Conviene hacerlo después de 01, 02, 03 y 05.
**Archivos a tocar:** `src/controllers/crearPagina.controller.clean.js`,
`src/generators/DiagramParser.js`, `src/generators/ValidationUtils.js`,
`src/generators/EntityGenerator.js`, `src/generators/FlutterScreenGenerator.js`,
`src/generators/SeedGenerator.js`, `src/generators/SqlDDLGenerator.js`.

## Síntoma

Dos cosas que hoy no se pueden expresar, por más que se dibujen bien en el diagrama:

- **Un campo opcional.** `observacion: String` sale obligatorio; la app no deja guardar sin
  llenarlo y el backend responde 400.
- **Un número negativo.** `temperatura: Double` sale con `@DecimalMin("0.0")` en el backend y
  con `if (numero < 0) return 'No puede ser negativo'` en el formulario Flutter. Un sistema de
  refrigeración, un saldo en rojo o una altitud bajo el nivel del mar no se pueden registrar.

Tampoco hay forma de decir "el correo es único", "el nombre tiene entre 3 y 50 caracteres" o
"el descuento va de 0 a 100".

## Causa

`ValidationUtils.generateValidationAnnotations` (`src/generators/ValidationUtils.js:3-28`)
decide todo a partir del tipo Java, sin consultar el modelo:

```js
if (!attr.isPrimaryKey) {
    if (attr.type === 'String') {
        annotations += '    @NotBlank(...)';
        if (!/^TEXT$/i.test(attr.sqlType || '')) { ... @Size(max = <largo de la columna>) }
    } else if (attr.type === 'Integer' || attr.type === 'Long') {
        annotations += '    @NotNull(...)';
        annotations += '    @Min(value = 0, ...)';       // <- inventado
    } else if (attr.type === 'Double' || attr.type === 'BigDecimal') {
        annotations += '    @NotNull(...)';
        annotations += '    @DecimalMin(value = "0.0", ...)';   // <- inventado
    } else {
        annotations += '    @NotNull(...)';
    }
}
```

Lo usan `EntityGenerator.js:475` (la entidad JPA) y `DTOGenerator.js:93` (el DTO, que es donde
el `@Valid` del controlador las hace cumplir).

En Flutter la misma decisión está repetida a mano en `FlutterScreenGenerator`:

- `obligatorio: a.isForeignKey ? a.isRequired === true : true` (`:340`) — o sea, todo lo que no
  sea FK es obligatorio;
- `'Campo obligatorio'` fijo en los campos de texto, fecha y hora (`:563`, `:589`, `:597`);
- `if (numero < 0) return 'No puede ser negativo';` fijo en los numéricos (`:578`).

Por eso hay que tocar los dos generadores: si solo se cambia el backend, la app sigue
rechazando en el teléfono lo que el servidor ya aceptaría.

Nota de contexto: `@NotBlank` y `@Size` **no son un descuido**, se agregaron a propósito porque
sin ellos un texto más largo que la columna llegaba a la base y respondía un error de
integridad ilegible. Lo que hay que cambiar es de dónde sale el límite, no que exista.

## El único dato de multiplicidad que ya existe

`isRequired` ya está en la cadena, pero solo se usa para FK de composición: lo pone
`crearPagina.controller.clean.js:315` (`isRequired: conn.type === 'composition'`) y lo lee
`DTOGenerator.js:113`. Para los atributos normales nunca se llena.

## Qué hacer

### Paso 1 — notación en el propio atributo, sin tocar el editor

El editor (otro repositorio) manda los atributos como texto (`"- precio: Double"`) o como
objeto (`{name, type, ...}`), y los dos casos pasan por
`CrearPaginaController.convertirFrontendADiagramParser` → `processedAttributes`
(`src/controllers/crearPagina.controller.clean.js:90-130`). Es el **único** punto de entrada:
la exportación de Flutter lo reutiliza (`flutterExport.controller.js:53`), así que con un solo
cambio quedan los dos generadores servidos.

Usar la notación de restricciones de UML, entre llaves, al final del atributo:

```
- observacion: String {0..1}          opcional
- nombre: String {3..50}              largo mínimo y máximo (es String, así que son caracteres)
- temperatura: Double {min=-50, max=80}
- descuento: Integer {min=0, max=100}
- correo: String {unico}
- codigo: String {unico, 1..20}
- cantidad: Integer                   sin llaves: obligatorio, sin mínimo (ver paso 5)
```

Es notación UML estándar, así que se puede escribir en el editor actual sin cambiarlo y se ve
bien en el diagrama impreso del documento.

### Paso 2 — leer las llaves en `processedAttributes`

Función nueva en el mismo archivo, aplicada **en las dos ramas** (la de texto y la de objeto,
porque el editor puede mandar el nombre con las llaves dentro):

```js
/**
 * Restricciones UML escritas entre llaves: {0..1} opcional, {3..50} largo de texto,
 * {min=-50, max=80} rango numérico, {unico}. Sin llaves se asume obligatorio (1..1).
 */
restriccionesDe = (texto) => {
    const bruto = String(texto || '');
    const llaves = bruto.match(/\{([^}]*)\}/);
    const limpio = bruto.replace(/\{[^}]*\}/g, '').trim();
    const reglas = { obligatorio: true, unico: false, minimo: null, maximo: null };
    if (!llaves) return { limpio, reglas };
    const partes = llaves[1].split(',').map((p) => p.trim()).filter(Boolean);
    for (const parte of partes) {
        const rango = parte.match(/^(\d+)\s*\.\.\s*(\d+|\*)$/);     // 0..1, 3..50, 1..*
        const min = parte.match(/^min\s*=\s*(-?\d+(?:\.\d+)?)$/i);
        const max = parte.match(/^max\s*=\s*(-?\d+(?:\.\d+)?)$/i);
        if (/^(unico|unique)$/i.test(parte)) reglas.unico = true;
        else if (/^(opcional|optional)$/i.test(parte)) reglas.obligatorio = false;
        else if (rango) {
            const desde = Number(rango[1]);
            const hasta = rango[2] === '*' ? null : Number(rango[2]);
            // 0..1 y 0..* significan "puede no estar"; 3..50 en un texto es el largo
            if (desde === 0 && (hasta === 1 || hasta === null)) reglas.obligatorio = false;
            else { reglas.minimo = desde; reglas.maximo = hasta; }
        } else if (min) reglas.minimo = Number(min[1]);
        else if (max) reglas.maximo = Number(max[1]);
    }
    return { limpio, reglas };
};
```

Cuidado con el orden: hay que quitar las llaves **antes** de partir por `:` y por `=`, porque
`{min=-50}` tiene un `=` que hoy se interpretaría como valor por defecto
(`crearPagina.controller.clean.js:98-102`). Ese es el único punto delicado del paso.

El atributo resultante suma cuatro campos: `obligatorio`, `unico`, `minimo`, `maximo`. Los dos
de largo de texto se pueden guardar en los mismos `minimo`/`maximo` (para `String` significan
caracteres) y así no se multiplican los campos.

### Paso 3 — pasarlos por `DiagramParser`

`src/generators/DiagramParser.js:40-55`, agregar a `processAttributes`:

```js
obligatorio: attr.obligatorio !== false,
unico: attr.unico === true,
minimo: attr.minimo ?? null,
maximo: attr.maximo ?? null,
```

Si no se agregan aquí, se pierden: `processAttributes` construye objetos nuevos y descarta lo
que no esté en la lista. Es el error más fácil de cometer en esta corrección.

### Paso 4 — `ValidationUtils` con las reglas del modelo

```js
static generateValidationAnnotations(attr) {
    if (attr.isPrimaryKey) return '';
    let anotaciones = '';
    const obligatorio = attr.obligatorio !== false;
    const esTexto = attr.type === 'String';
    const esEntero = attr.type === 'Integer' || attr.type === 'Long';
    const esDecimal = attr.type === 'Double' || attr.type === 'BigDecimal';

    if (esTexto) {
        if (obligatorio) anotaciones += `    @NotBlank(message = "${attr.name} no puede estar vacío")\n`;
        // El largo máximo sale del modelo si lo declararon; si no, del largo de la columna,
        // porque un texto más largo llega a la base y responde error de integridad.
        const largoColumna = /^TEXT$/i.test(attr.sqlType || '')
            ? null : (attr.sqlType?.match(/\d+/)?.[0] || '255');
        const max = attr.maximo ?? largoColumna;
        const min = obligatorio && attr.minimo ? attr.minimo : 0;
        if (max) anotaciones += `    @Size(min = ${min}, max = ${max}, message = "...")\n`;
    } else {
        if (obligatorio) anotaciones += `    @NotNull(message = "${attr.name} no puede ser nulo")\n`;
        if (attr.minimo !== null && attr.minimo !== undefined) {
            anotaciones += esDecimal
                ? `    @DecimalMin(value = "${attr.minimo}", message = "...")\n`
                : `    @Min(value = ${attr.minimo}, message = "...")\n`;
        }
        if (attr.maximo !== null && attr.maximo !== undefined) {
            anotaciones += esDecimal
                ? `    @DecimalMax(value = "${attr.maximo}", message = "...")\n`
                : `    @Max(value = ${attr.maximo}, message = "...")\n`;
        }
    }
    return anotaciones;
}
```

Mensajes en español, con el nombre del campo, como están hoy.

### Paso 5 — qué se asume cuando el diagrama no dice nada

Esta es la decisión de fondo, y conviene tomarla explícitamente:

| Regla | Valor por defecto | Por qué |
|---|---|---|
| Obligatorio | **sí** | En UML un atributo sin multiplicidad es `1..1`. Es lo que ya hace hoy y no rompe los tableros existentes. |
| Largo de texto | el de la columna | Ya existe y evita el error de integridad. |
| Mínimo numérico | **ninguno** | `@Min(0)` no tiene respaldo en el modelo: es lo que impide guardar una temperatura negativa. **Quitarlo.** |
| Máximo numérico | ninguno | Igual. |
| Único | no | Solo si lo declaran. |

O sea: de las dos quejas, "todo obligatorio" se queda (es el default de UML, y quien quiera
opcional escribe `{0..1}`) y "nada negativo" se va. Al quitar `@Min(0)`/`@DecimalMin("0.0")`
hay que revisar que nada más dependa de ellos; ver "Riesgos".

### Paso 6 — `unico` en la columna

`EntityGenerator`, donde arma `@Column` (alrededor de `src/generators/EntityGenerator.js:396`):
agregar `unique = true` cuando `attr.unico`, y `nullable = false` cuando `attr.obligatorio`.
Lo mismo en `SqlDDLGenerator` para que el script SQL y la entidad no se contradigan.

En el controlador generado, `DataIntegrityViolationException` ya se traduce a un 409 con
`MENSAJE_INTEGRIDAD` (`ControllerGenerator.js`), así que el choque de un valor repetido sale
con un mensaje entendible sin trabajo extra.

### Paso 7 — Flutter usa las mismas reglas

En `FlutterScreenGenerator`:

1. `:340` — `obligatorio` sale del atributo, no de si es FK:
   ```js
   obligatorio: a.isForeignKey ? a.isRequired === true : a.obligatorio !== false,
   ```
   y llevar también `minimo` y `maximo` al descriptor del campo (`c.minimo`, `c.maximo`).
2. Texto (`:563`): validar obligatorio solo si lo es, y agregar largo mínimo y máximo.
   Poner `maxLength: c.maximo` en el `TextFormField` para que además no deje escribir de más.
3. Numéricos (`:573-581`): **quitar** el `if (numero < 0) return 'No puede ser negativo';` y
   emitir en su lugar las comparaciones que correspondan:
   ```dart
   if (numero < ${c.minimo}) return 'No puede ser menor que ${c.minimo}';
   if (numero > ${c.maximo}) return 'No puede ser mayor que ${c.maximo}';
   ```
   solo cuando esos valores existan.
4. Fecha y hora (`:589`, `:597`): `'Campo obligatorio'` solo si `c.obligatorio`.

### Paso 8 — el sembrador tiene que respetar el rango

`src/generators/SeedGenerator.js` inventa valores de ejemplo. Si un campo declara
`{min=-50, max=80}`, el valor sembrado tiene que caer dentro, y si declara `{unico}` los tres
registros tienen que diferir. Hoy ya recorta los textos al largo de la columna (`recortar`);
extender esa idea a los números y a la unicidad. Si no se hace, la siembra empieza a fallar con
`ConstraintViolationException` al arrancar, que es justo lo que se arregló hace poco.

## Criterio de aceptación

1. Diagrama de prueba `correcciones/pruebas/diagramas/validaciones.json` con:
   `Medicion` → `observacion: String {0..1}`, `temperatura: Double {min=-50, max=80}`,
   `codigo: String {unico, 1..20}`, `porcentaje: Integer {min=0, max=100}`.
2. Exportar y compilar: `BUILD SUCCESS`.
3. La entidad y el DTO tienen `@DecimalMin("-50.0")` y `@DecimalMax("80.0")` en `temperatura`,
   **no** tienen `@NotBlank` en `observacion`, y `codigo` sale con `unique = true`.
4. Levantar y probar:
   - `POST` sin `observacion` → 201.
   - `POST` con `"temperatura": -12.5` → 201.
   - `POST` con `"temperatura": 120` → 400 con el mensaje del máximo.
   - `POST` con un `codigo` repetido → 409.
5. Arranca y siembra sin `ConstraintViolationException`.
6. `flutter analyze` → `No issues found!`, y en la app: `observacion` se puede dejar en blanco,
   `temperatura` acepta `-12.5`, y `porcentaje` rechaza `150`.
7. **Los cinco tableros de ejemplo siguen generando exactamente lo mismo que antes**, salvo la
   desaparición de `@Min(0)`/`@DecimalMin("0.0")` y del "No puede ser negativo" del formulario.
   Compararlo con `git diff` sobre una exportación guardada antes del cambio.

## Riesgos y qué no tocar

- **Al quitar `@Min(0)` hay que mirar `SeedGenerator` y los tableros con precios y cantidades.**
  Ninguno depende de que el backend rechace negativos, pero conviene confirmarlo con la batería
  de [07](07-pruebas-automaticas.md).
- **`MetadataBuilder` no se entera de los campos nuevos** y no le hace falta: `obligatorio`,
  `unico`, `minimo` y `maximo` no cambian qué getters existen. Si algún generador empieza a
  saltarse atributos con un `console.warn`, el problema está en otro lado.
- **No inventar heurísticas por nombre de campo** (tipo "si se llama `precio` entonces min=0").
  Es justo lo que esta corrección viene a quitar.
- **Compatibilidad hacia atrás:** un diagrama guardado sin llaves tiene que seguir generando lo
  mismo. De ahí que `obligatorio` sea `true` por defecto y que se lea con `!== false`.
- Si más adelante el editor gana casillas para estas propiedades, lo único que cambia es que
  llegarán ya separadas en el objeto del atributo; el resto de la cadena sigue igual. Conviene
  dejar la rama de objeto de `processedAttributes` leyendo `attr.obligatorio` / `attr.unico` /
  `attr.minimo` / `attr.maximo` si vienen, y las llaves solo como respaldo.
