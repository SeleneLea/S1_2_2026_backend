# 03 · No se pueden vaciar relaciones ni borrar valores opcionales

**Gravedad: alta.** Pérdida silenciosa de un cambio del usuario: la app dice que guardó y el
dato vuelve como estaba.
**Archivos a tocar:** `src/generators/ServiceGenerator.js` (principal),
`src/generators/DTOGenerator.js`, `src/generators/MapperGenerator.js`,
`src/generators/FlutterModelGenerator.js`.

## Síntoma

1. En la app Flutter, editar un `Producto` que tiene tres categorías marcadas, **desmarcar
   todas** y guardar. La app confirma. Al volver a la lista, el producto sigue con sus tres
   categorías.
2. Un `Pedido` con un `Cliente` opcional: no hay manera de dejarlo sin cliente. Mandar
   `"clienteId": null` no borra nada.

## Cómo reproducirlo con curl

Sobre cualquier proyecto generado con un muchos a muchos (por ejemplo el tablero `tienda`):

```bash
# 1. ver el registro
curl -s "http://localhost:8091/api/producto/1" -H "Authorization: Bearer $TOK"
#    -> {"data":{"id":1,...,"categoriaIds":[1,2,3]}, ...}

# 2. guardarlo con la lista vacía (lo mismo que manda Flutter al desmarcar todo)
curl -s -X PUT "http://localhost:8091/api/producto/1" \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"nombre":"Camisa","precio":100,"categoriaIds":[]}'
#    -> 200 "Producto actualizado exitosamente"

# 3. volver a verlo
curl -s "http://localhost:8091/api/producto/1" -H "Authorization: Bearer $TOK"
#    -> categoriaIds sigue siendo [1,2,3]
```

Verificado leyendo el código de los cuatro archivos de la cadena; la secuencia de curl de
arriba no se ejecutó contra un proyecto generado.

## Causa

### La condición que ignora la lista vacía

`ServiceGenerator.generateUpdateFieldsLogic`, bloque de muchos a muchos
(`src/generators/ServiceGenerator.js:449-457`):

```js
this.getMuchosAMuchosPropios(entity).forEach(otra => {
    const coleccion = this.capitalize(this.toCamelCase(otra.name) + 's');
    updates += `        // Muchos a muchos: ${otra.name} (se reemplaza si se envía la lista)
        if (updated.get${coleccion}() != null && !updated.get${coleccion}().isEmpty()) {
            existing.set${coleccion}(updated.get${coleccion}());
        }
`;
});
```

`!isEmpty()` es exactamente lo que impide vaciar. Y para los campos sueltos y las FK, el
mismo método emite `if (updated.getX() != null)` (`:396-398`, `:427-443` y
`generateActualizarHeredados` en `:463-485`), que impide poner algo en nulo.

### Por qué la lista llega vacía y no nula

La cadena completa, para que quede claro que el arreglo va en el servicio y no antes:

| Paso | Archivo | Qué hace |
|---|---|---|
| Flutter manda `"categoriaIds": []` | `FlutterModelGenerator.js:52` | el modelo incluye la lista de IDs (`claveMuchosAMuchos`, `FlutterNombres.js:63`) |
| El DTO la recibe | `DTOGenerator.js:132` | `private List<Long> categoriaIds = new ArrayList<>();` → **nunca es null** |
| El mapper la pasa a la entidad | `MapperGenerator.js:224-238` | `if (dto.getCategoriaIds() != null)` → pone una colección **vacía** |
| El servicio la descarta | `ServiceGenerator.js:451` | `!isEmpty()` → no hace nada |

### El fondo del asunto: PUT y PATCH usan el mismo método

`ControllerGenerator` genera dos endpoints distintos:

- `PUT /api/x/{id}` (`ControllerGenerator.js:182-206`) con `@Valid @RequestBody XDTO dto`
- `PATCH /api/x/{id}` (`:213-236`) con `@RequestBody XDTO dto`, sin `@Valid`

pero en `ServiceGenerator` **los dos llaman a `updateEntityFields(existing, entity)`**, así que
hoy no hay ninguna diferencia de comportamiento entre reemplazar y parchear. Ahí está el
arreglo: son dos semánticas distintas y necesitan dos métodos.

Dato que hace el cambio seguro: el DTO lleva las validaciones de `ValidationUtils`
(`DTOGenerator.js:93`), o sea que hoy **un PUT ya está obligado a mandar todos los campos
sueltos**, porque si falta uno el `@Valid` responde 400 antes de llegar al servicio. Por eso
pasar el PUT a reemplazo completo no cambia nada para los campos normales: solo arregla las
listas y las FK opcionales.

## Qué hacer

### Paso 1 — dos métodos en la entidad de servicio generada

En la plantilla de `generateServiceImplementation` (`ServiceGenerator.js:218`), donde hoy dice:

```java
    private void updateEntityFields(${entity.name} existing, ${entity.name} updated) {
${this.generateUpdateFieldsLogic(entity)}
    }
```

generar dos:

```java
    /**
     * PUT: el cliente manda el registro completo, así que se reemplaza campo por campo.
     * Una lista vacía vacía la relación y un valor nulo la quita: es la única forma de
     * que el usuario pueda desmarcar todo y que el cambio se guarde.
     */
    private void reemplazarCampos(${entity.name} existing, ${entity.name} updated) {
${this.generateUpdateFieldsLogic(entity, { modo: 'reemplazar' })}
    }

    /**
     * PATCH: solo se tocan los campos que llegaron. Nulo significa "no lo mandaron".
     */
    private void combinarCampos(${entity.name} existing, ${entity.name} updated) {
${this.generateUpdateFieldsLogic(entity, { modo: 'combinar' })}
    }
```

Y en los métodos públicos:

- `update(...)` llama a `reemplazarCampos(existing, entity)`
- `partialUpdate(...)` llama a `combinarCampos(existing, entity)`

### Paso 2 — `generateUpdateFieldsLogic` con modo

Firma nueva: `generateUpdateFieldsLogic(entity, { modo = 'combinar' } = {})`. La única
diferencia es si el `if` se emite o no:

```js
const asignar = (cap) => modo === 'reemplazar'
    ? `        existing.set${cap}(updated.get${cap}());\n`
    : `        if (updated.get${cap}() != null) {
            existing.set${cap}(updated.get${cap}());
        }\n`;
```

Aplicarlo en los cuatro bloques del método: campos sueltos (`:391-412`), FK (`:414-446`),
heredados (`generateActualizarHeredados`, hay que pasarle el modo también) y muchos a muchos
(`:449-457`). En el de muchos a muchos, en modo `combinar`, **quitar el `!isEmpty()`** y dejar
solo `!= null`; en modo `reemplazar`, asignar siempre.

No tocar los `console.warn` ni la comprobación de `entityMeta.entity.getters`: siguen siendo
necesarios para las entidades cuyos getters no existen.

### Paso 3 — que el DTO distinga "no vino" de "vino vacía"

`DTOGenerator.js:132`:

```js
// antes
fields += `    private List<${pkType}> ${fieldName} = new ArrayList<>(); // Muchos a muchos con ${otra.name}\n`;
// después: sin valor inicial, para que PATCH pueda distinguir "no la mandaron" de "mándala vacía"
fields += `    private List<${pkType}> ${fieldName}; // Muchos a muchos con ${otra.name}\n`;
```

Esto tiene dos consecuencias que hay que atender:

1. **En el mapper** (`MapperGenerator.js:205-219`, `generateMuchosAMuchosToDTO`), al convertir
   entidad → DTO, si la colección es nula hoy no se asigna nada y el DTO respondía `[]`; ahora
   respondería `null`. Para que la app no reciba `null` donde esperaba lista, emitir el `else`:

   ```java
   if (entity.getCategorias() != null) {
       dto.setCategoriaIds(entity.getCategorias().stream()...);
   } else {
       dto.setCategoriaIds(new ArrayList<>());
   }
   ```

   Así **la respuesta** siempre trae lista (aunque vacía) y solo **la petición** puede traer
   null.

2. **En el modelo Flutter** (`FlutterModelGenerator`), el `fromJson` de esa clave tiene que
   tolerar `null` y dejar la lista vacía. Revisar cómo lo arma hoy (`FlutterModelGenerator.js:52`
   y el helper `escribir`) y asegurar algo equivalente a:

   ```dart
   categoriaIds: ((json['categoriaIds'] as List?) ?? const []).map((e) => e as int).toList(),
   ```

### Paso 4 — comprobar que Flutter manda el objeto completo en PUT

La pantalla de formulario (`FlutterScreenGenerator.js:346` y el guardado que arma el `toJson`)
ya incluye `xIds`. Confirmar que al guardar manda **todos** los campos, incluidas las listas
vacías, y que usa `putData` (PUT) y no PATCH. Si en algún caso usa PATCH, cambiarlo a PUT: la
app siempre tiene el registro completo en el formulario.

### Paso 5 — nota en el README generado

En la sección de la API, agregar dos líneas:

```
PUT   /api/producto/{id}   reemplaza el registro completo. Una lista vacía quita todas las
                           relaciones; un campo opcional en null lo deja sin valor.
PATCH /api/producto/{id}   cambia solo los campos que mandes; lo que no mandes queda igual.
```

## Criterio de aceptación

Sobre el tablero `tienda` (o cualquiera con muchos a muchos), con el backend levantado:

1. `PUT` con `"categoriaIds": []` → al volver a consultar, `categoriaIds` es `[]`.
2. `PUT` con `"categoriaIds": [2]` → queda exactamente `[2]` (no `[1,2,3]` más el 2).
3. `PATCH` **sin** la clave `categoriaIds` → las categorías quedan como estaban.
4. `PATCH` con `"categoriaIds": []` → quedan vacías.
5. Una FK opcional: `PUT` sin esa clave (o con `null`) → queda en `null` y `GET` lo confirma.
   Una FK obligatoria (composición, `attr.isRequired`) sigue respondiendo 400 por el `@NotNull`
   del DTO.
6. En la base de datos, las filas de la tabla intermedia del caso 1 ya no están:
   `SELECT count(*) FROM producto_categoria WHERE producto_id = 1;` → 0.
7. En la app Flutter: desmarcar todas las categorías, guardar, volver a abrir el registro →
   aparece sin categorías.
8. La batería de [07](07-pruebas-automaticas.md) sigue verde en los cinco tableros, con
   especial atención al `crear sin id` (201) y a que ningún endpoint devuelva error.

## Riesgos y qué no tocar

- **Un PUT parcial ahora borra lo que no se manda.** Es la semántica correcta de PUT y el
  `@Valid` del DTO ya obligaba a mandar todos los campos sueltos, pero cualquier cliente
  hecho a mano que mandaba PUT incompleto (por ejemplo pruebas con curl) tiene que pasar a
  PATCH. Dejarlo dicho en el README.
- **No quitar `resolveForeignKeys`.** Sigue siendo necesario: convierte los objetos temporales
  con solo el ID en entidades reales. Ya tolera nulos (`ServiceGenerator.js:519`: `if (entity.getX() != null)`)
  y la lista vacía simplemente no entra a su bloque (`:546`), así que funciona con este cambio
  sin tocarlo.
- **Herencia:** `generateActualizarHeredados` recorre la cadena de padres; al pasarle el modo
  hay que mantener el filtro `!propios.has(attr.name)` que evita asignar dos veces el mismo
  campo. Comprobar con los tableros `academico` y `bancario`, que son los que tienen herencia.
- No cambiar `@Valid` del PUT por algo más laxo: es lo que sostiene que el reemplazo completo
  sea seguro.
