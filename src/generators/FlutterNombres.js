/**
 * Nombres y tipos compartidos por los generadores de Flutter.
 *
 * El contrato JSON lo fija el backend Spring Boot generado desde el mismo
 * diagrama: el nombre de cada campo sale de DTOGenerator (toCamelCase) y la
 * clave JSON es la que Jackson deriva de su getter. Si Flutter los calcula de
 * otra forma, la app no lee ni envía esos campos (antes pasaba con atributos
 * como "fecha_registro", que el backend expone como "fechaRegistro").
 */

const RESERVADAS_DART = new Set([
    'abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
    'continue', 'covariant', 'default', 'deferred', 'do', 'dynamic', 'else', 'enum', 'export',
    'extends', 'extension', 'external', 'factory', 'false', 'final', 'finally', 'for', 'Function',
    'get', 'hide', 'if', 'implements', 'import', 'in', 'interface', 'is', 'late', 'library',
    'mixin', 'new', 'null', 'on', 'operator', 'part', 'required', 'rethrow', 'return', 'set',
    'show', 'static', 'super', 'switch', 'sync', 'this', 'throw', 'true', 'try', 'typedef',
    'var', 'void', 'while', 'with', 'yield'
]);

/** Nombre del campo Java en el DTO (igual que DTOGenerator.toCamelCase). */
export const campoJava = (nombre) => {
    const s = String(nombre || '');
    if (s.includes('_')) {
        return s.split('_')
            .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
            .join('');
    }
    return s.charAt(0).toLowerCase() + s.slice(1);
};

/** Clave JSON que Jackson deriva del getter get<Campo>: minúsculas las mayúsculas iniciales. */
export const claveJson = (campo) => {
    const getter = campo.charAt(0).toUpperCase() + campo.slice(1);
    return getter.replace(/^[A-Z]+/, (m) => m.toLowerCase());
};

/**
 * Dart no admite tildes ni eñes en los nombres de variables o clases (Java sí), así que los
 * identificadores se pasan a ASCII: la clase "Día" es "Dia" y el campo "díaId" es "diaId".
 * Las claves JSON no cambian: siguen viajando con tilde, como las expone el backend.
 */
export const aAscii = (texto) => {
    const limpio = String(texto ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')   // quita los acentos ya separados
        .replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
        .replace(/[^A-Za-z0-9_]/g, '');
    return /^[0-9]/.test(limpio) ? `n${limpio}` : limpio;
};

/** Identificador Dart válido para una clave JSON. */
export const identificadorDart = (clave) => {
    const nombre = aAscii(clave) || 'campo';
    return RESERVADAS_DART.has(nombre) ? `${nombre}Valor` : nombre;
};

/** Clave JSON de un atributo tal como la expone el DTO (las FK terminan en "Id"). */
export const claveDeAtributo = (attr) =>
    claveJson(attr.isForeignKey ? `${campoJava(attr.name)}Id` : campoJava(attr.name));

/** Clave JSON de la lista de IDs de un muchos a muchos (p. ej. "productoIds"). */
export const claveMuchosAMuchos = (otra) => claveJson(`${campoJava(otra.name)}Ids`);

export const tipoDart = (javaType) => ({
    String: 'String', UUID: 'String',
    Integer: 'int', int: 'int', Long: 'int', long: 'int',
    Double: 'double', double: 'double', Float: 'double', float: 'double', BigDecimal: 'double',
    Boolean: 'bool', boolean: 'bool',
    LocalDateTime: 'DateTime', LocalDate: 'DateTime', Date: 'DateTime',
    // LocalTime viaja como "HH:mm:ss"; en Dart no hay un tipo de hora sin fecha
    LocalTime: 'String'
}[javaType] || 'String');

/** LocalDate viaja como "yyyy-MM-dd"; LocalDateTime como "yyyy-MM-ddTHH:mm:ss". */
export const esSoloFecha = (javaType) => javaType === 'LocalDate' || javaType === 'Date';

export const esHora = (javaType) => javaType === 'LocalTime';

/** Largo máximo que acepta el backend (@Size), o null si no tiene (TEXT o no es texto). */
export const largoMaximo = (attr) => {
    if (attr.type !== 'String' || attr.isForeignKey || /^TEXT$/i.test(attr.sqlType || '')) return null;
    return Number(attr.sqlType?.match(/\d+/)?.[0] || 255);
};

export const nombreClase = (nombre) => {
    const limpio = aAscii(nombre) || 'Clase';
    return limpio.charAt(0).toUpperCase() + limpio.slice(1);
};

/** Nombre de archivo Dart en snake_case: DetalleVenta -> detalle_venta */
export const archivoDart = (nombre) =>
    (aAscii(nombre) || 'modelo').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/** Texto legible para etiquetas: "precioVenta" -> "Precio venta", "categoriaId" -> "Categoria" */
export const etiquetaCampo = (texto) => {
    const legible = String(texto)
        .replace(/_/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/ Id$/, '')
        .trim()
        .toLowerCase();
    return legible.charAt(0).toUpperCase() + legible.slice(1);
};

/** Contenido seguro para un literal Dart entre comillas simples. */
export const textoDart = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$');

export const esAuxiliar = (e) => e.stereotype === 'interface' || e.stereotype === 'enumeration';
export const esAbstracta = (e) => e.isAbstract === true || e.stereotype === 'abstract';

/** Padre en una herencia (la flecha va del hijo al padre). */
export const padreDe = (entity, entities, relationships) => {
    const rel = relationships.find(r => r.type === 'inheritance' && r.source === entity.id);
    return rel ? entities.find(e => e.id === rel.target) || null : null;
};

/**
 * Atributos del DTO: los heredados del padre y los propios, sin repetir la PK ni
 * la FK al padre (igual que DTOGenerator, cuyo DTO hijo extiende el del padre).
 */
export const atributosDTO = (entity, entities, relationships, visitados = new Set()) => {
    if (visitados.has(entity.id)) return entity.attributes;
    visitados.add(entity.id);
    const padre = padreDe(entity, entities, relationships);
    const heredados = padre ? atributosDTO(padre, entities, relationships, visitados) : [];
    const claves = new Set(heredados.map(claveDeAtributo));
    const propios = entity.attributes.filter(a =>
        !(padre && a.isPrimaryKey) &&
        !(padre && a.isForeignKey && a.referencedEntity === padre.name) &&
        !claves.has(claveDeAtributo(a))
    );
    return [...heredados, ...propios];
};

export const pkDe = (entity, entities, relationships) =>
    atributosDTO(entity, entities, relationships).find(a => a.isPrimaryKey) || null;

/** Muchos a muchos de los que la entidad es dueña: mismo criterio que el backend. */
export const muchosAMuchosPropios = (entity, entities, relationships) =>
    relationships
        .filter(r => r.type === 'many-to-many-direct' && r.source === entity.id)
        .map(r => entities.find(e => e.id === r.target))
        .filter(Boolean)
        .filter(otra =>
            !entity.attributes.some(a => a.isForeignKey && a.referencedEntity === otra.name) &&
            !otra.attributes.some(a => a.isForeignKey && a.referencedEntity === entity.name)
        );

/** Entidades cuyas opciones necesita el formulario (FK y muchos a muchos con API). */
export const referenciasConOpciones = (entity, entities, relationships, entidadesConApi) => {
    const conApi = new Set(entidadesConApi.map(e => e.name));
    const nombres = [];
    atributosDTO(entity, entities, relationships).forEach(a => {
        if (a.isForeignKey && conApi.has(a.referencedEntity) && !nombres.includes(a.referencedEntity)) {
            nombres.push(a.referencedEntity);
        }
    });
    muchosAMuchosPropios(entity, entities, relationships).forEach(o => {
        if (conApi.has(o.name) && !nombres.includes(o.name)) nombres.push(o.name);
    });
    return nombres.map(n => entities.find(e => e.name === n)).filter(Boolean);
};

/** Atributo más descriptivo para mostrar un registro (nombre, título, código...). */
export const atributoDescriptivo = (atributos) => {
    const normales = atributos.filter(a => !a.isPrimaryKey && !a.isForeignKey);
    const preferidos = ['nombre', 'name', 'titulo', 'title', 'descripcion', 'description', 'codigo', 'code'];
    for (const p of preferidos) {
        const a = normales.find(x => campoJava(x.name).toLowerCase().includes(p) && tipoDart(x.type) === 'String');
        if (a) return a;
    }
    return normales.find(a => tipoDart(a.type) === 'String') || null;
};
