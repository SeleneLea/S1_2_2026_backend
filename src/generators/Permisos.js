import EntityGenerator from './EntityGenerator.js';
import { detectarRoles } from './AuthGenerator.js';

const ACCIONES = ['ver', 'crear', 'editar', 'borrar'];
const ALCANCES = ['todos', 'propios', 'asignados', 'ninguno'];
const ascii = valor => String(valor ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '');
const rolDe = valor => ascii(valor).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
const nombreComparable = valor => ascii(valor).trim().toLowerCase();
const error = mensaje => {
    const fallo = new Error(`Permisos: ${mensaje}`);
    fallo.code = 'PERMISOS_INVALIDOS';
    throw fallo;
};
const valores = entrada => Array.isArray(entrada) ? entrada : Object.values(entrada || {});
const esAuxiliar = e => ['interface', 'enumeration', 'association_table'].includes(e.stereotype);
const esAbstracta = e => e.isAbstract || e.stereotype === 'abstract';

/** Activa la edición de enlaces M:N por ambos extremos solo en proyectos con política. */
export function aplicarPermisos(entidades, relaciones, politica) {
    for (const entidad of entidades) entidad.editarInversas = politica?.explicito === true;
    return entidades;
}

/** Propiedades M:N del DTO/servicio, incluidos los enlaces heredados. */
export function muchosAMuchosEditables(entidad, entidades, relaciones, { heredadas = true } = {}) {
    const generador = new EntityGenerator(entidades, relaciones);
    const resultado = [];
    const propiedades = new Set();
    const visitadas = new Set();
    for (let actual = entidad; actual && !visitadas.has(actual.id);
        actual = heredadas ? generador.getParentEntity(actual.id) : null) {
        visitadas.add(actual.id);
        for (const relacion of generador.getManyToManyRelationships(actual)) {
            if (!relacion.isOwner && entidad.editarInversas !== true) continue;
            const propiedad = generador.toCamelCase(relacion.relatedEntity.name) + 's';
            if (propiedades.has(propiedad)) continue;
            propiedades.add(propiedad);
            resultado.push({ otra: relacion.relatedEntity, propiedad, declaradora: actual,
                propietaria: relacion.isOwner, propiedadPropietaria: generador.toCamelCase(actual.name) + 's' });
        }
    }
    return resultado;
}

/** Extrae la política antes de convertir atributos UML, sin mutar el diagrama original. */
export function extraerPermisos(elementos, conexiones = [], reglasJSON = null) {
    const lista = valores(elementos);
    const clases = lista.filter(e => {
        const nombre = e.name || e.data?.className;
        return nombreComparable(nombre) === 'permisos' &&
            (e.type === 'class' || e.type === 'classNode' || e.data?.className);
    });
    if (clases.length > 1) error('hay más de una clase Permisos. Declara una sola política.');
    if (reglasJSON != null && !Array.isArray(reglasJSON)) error('el campo permisos debe ser una lista de reglas.');
    if (clases.length && reglasJSON != null) error('declara las reglas en la clase Permisos o en el campo JSON permisos, no en ambos.');
    let permisosCrudos = reglasJSON;
    if (clases.length) {
        const clase = clases[0];
        const atributos = clase.attributes?.length ? clase.attributes : (clase.data?.attributes || clase.attributes || []);
        if (!Array.isArray(atributos)) error('los atributos de la clase Permisos deben ser una lista.');
        permisosCrudos = atributos.map(a => typeof a === 'string' ? a
            : (a && typeof a === 'object' && 'rol' in a) ? a
                : `${a?.name ?? ''}: ${a?.type ?? ''}`);
    }
    const idsPermisos = new Set(clases.map(e => e.id));
    const restantes = lista.filter(e => !idsPermisos.has(e.id));
    const idsRestantes = new Set(restantes.map(e => e.id));
    return {
        elementos: restantes,
        conexiones: valores(conexiones).filter(r => idsRestantes.has(r.source) && idsRestantes.has(r.target)),
        permisosCrudos: permisosCrudos == null ? null : [...permisosCrudos],
    };
}

function leerRegla(bruta, indice) {
    let regla;
    if (typeof bruta === 'string') {
        const texto = bruta.trim().replace(/^[+\-#~]\s*/, '');
        const partes = texto.match(/^([^:]+):\s*(\S+)\s+([\p{L},\s]+?)\s+(todos|propios|asignados|ninguno)\s*$/iu);
        if (!partes) error(`regla ${indice + 1} inválida: usa ROL: Modulo accion[,accion] alcance.`);
        regla = { rol: partes[1].trim(), modulo: partes[2], acciones: partes[3].split(','), alcance: partes[4].toLowerCase() };
    } else if (bruta && typeof bruta === 'object' && !Array.isArray(bruta)) {
        const desconocidas = Object.keys(bruta).filter(k => !['rol', 'modulo', 'acciones', 'alcance', 'camino'].includes(k));
        if (desconocidas.length) error(`regla ${indice + 1}: campos desconocidos ${desconocidas.join(', ')}.`);
        regla = { ...bruta };
    } else error(`regla ${indice + 1} debe ser texto o un objeto.`);
    if (typeof regla.rol !== 'string' || !regla.rol.trim()) error(`regla ${indice + 1}: falta el rol.`);
    if (typeof regla.modulo !== 'string' || !regla.modulo.trim()) error(`regla ${indice + 1}: falta el módulo.`);
    if (typeof regla.alcance !== 'string' || !ALCANCES.includes(regla.alcance)) error(`alcance desconocido en la regla ${indice + 1}: ${regla.alcance}.`);
    const acciones = typeof regla.acciones === 'string' ? regla.acciones.split(',') : regla.acciones;
    if (!Array.isArray(acciones) || acciones.some(a => typeof a !== 'string')) error(`regla ${indice + 1}: acciones debe ser una lista.`);
    const limpias = acciones.map(a => a.trim().toLowerCase());
    if (new Set(limpias).size !== limpias.length) error(`regla ${indice + 1}: hay acciones duplicadas.`);
    if (limpias.includes('todo') && limpias.length !== 1) error(`regla ${indice + 1}: todo no se combina con otras acciones.`);
    for (const accion of limpias) if (![...ACCIONES, 'todo'].includes(accion)) error(`acción desconocida "${accion}" en la regla ${indice + 1}.`);
    if (!limpias.length && regla.alcance !== 'ninguno') error(`regla ${indice + 1}: falta al menos una acción.`);
    if (regla.camino !== undefined && (!Array.isArray(regla.camino) || regla.camino.some(p => typeof p !== 'string' || !p.trim()))) {
        error(`regla ${indice + 1}: camino debe ser una lista de propiedades Java.`);
    }
    if (regla.camino !== undefined && !['propios', 'asignados'].includes(regla.alcance)) {
        error(`regla ${indice + 1}: camino solo corresponde a propios o asignados.`);
    }
    return { ...regla, rol: rolDe(regla.rol), modulo: regla.modulo.trim(),
        acciones: regla.alcance === 'ninguno' ? [] : limpias.includes('todo') ? [...ACCIONES] : limpias };
}

/** Grafo de propiedades que realmente emite JPA, no de líneas UML sin propiedad navegable. */
function grafoJpa(entidades, relaciones) {
    const generador = new EntityGenerator(entidades, relaciones);
    const porNombre = new Map(entidades.map(e => [e.name, e]));
    const cadenas = new Map();
    const cadena = entidad => {
        if (cadenas.has(entidad.id)) return cadenas.get(entidad.id);
        const resultado = [];
        const vistos = new Set();
        for (let actual = entidad; actual; actual = generador.getParentEntity(actual.id)) {
            if (vistos.has(actual.id)) error(`herencia circular en ${entidad.name}.`);
            vistos.add(actual.id);
            resultado.push(actual);
        }
        cadenas.set(entidad.id, resultado);
        return resultado;
    };
    const grafo = new Map();
    for (const entidad of entidades) {
        const propiedades = new Map();
        const agregar = (propiedad, destino, editable) => {
            if (!destino) return;
            const previa = propiedades.get(propiedad);
            if (previa && previa.destino.id !== destino.id) error(`la propiedad ${entidad.name}.${propiedad} apunta a dos entidades.`);
            propiedades.set(propiedad, { propiedad, destino, editable });
        };
        for (const declaradora of [...cadena(entidad)].reverse()) {
            const padre = generador.getParentEntity(declaradora.id);
            for (const a of declaradora.attributes || []) {
                if (a.isForeignKey && a.referencedEntity && !(padre && a.referencedEntity === padre.name)) {
                    agregar(generador.toCamelCase(a.name), porNombre.get(a.referencedEntity), true);
                }
            }
            for (const inversa of generador.getColeccionesInversas(declaradora)) agregar(inversa.fieldName, inversa.relatedEntity, false);
            for (const muchos of generador.getManyToManyRelationships(declaradora)) {
                agregar(generador.toCamelCase(muchos.relatedEntity.name) + 's', muchos.relatedEntity, true);
            }
        }
        grafo.set(entidad.id, [...propiedades.values()]);
    }
    const compatible = (a, b) => cadena(a).some(e => e.id === b.id) || cadena(b).some(e => e.id === a.id);
    const claveDe = entidad => {
        const raiz = [...cadena(entidad)].reverse();
        for (const e of raiz) {
            const claves = (e.attributes || []).filter(a => a.isPrimaryKey);
            if (claves.length > 1) error(`el titular ${entidad.name} tiene clave compuesta; declara una clave simple para vincular cuentas.`);
            if (claves.length === 1) return { campoId: generador.toCamelCase(claves[0].name), tipoId: claves[0].type };
        }
        error(`la entidad titular ${entidad.name} no tiene clave primaria.`);
    };
    return { grafo, compatible, claveDe };
}

function resolverCamino(modulo, titular, regla, modelo) {
    const etiqueta = `${regla.rol}: ${modulo.name} ${regla.acciones.join(',')} ${regla.alcance}`;
    if (regla.camino !== undefined) {
        let actual = modulo;
        for (const propiedad of regla.camino) {
            const paso = modelo.grafo.get(actual.id).find(p => p.propiedad === propiedad);
            if (!paso) error(`no puedo resolver "${etiqueta}": ${actual.name}.${propiedad} no es una relación JPA navegable.`);
            actual = paso.destino;
        }
        if (!modelo.compatible(actual, titular)) error(`el camino de "${etiqueta}" termina en ${actual.name}, no en ${titular.name}.`);
        return [...regla.camino];
    }
    let nivel = [{ entidad: modulo, camino: [], visitadas: new Set([modulo.id]) }];
    const distancias = new Map([[modulo.id, 0]]);
    const cantidades = new Map([[modulo.id, 1]]);
    while (nivel.length) {
        const resueltos = nivel.filter(n => modelo.compatible(n.entidad, titular));
        const distintos = new Map(resueltos.map(n => [JSON.stringify(n.camino), n.camino]));
        if (distintos.size > 1) error(`camino ambiguo para "${etiqueta}". Declara camino en el JSON: ${[...distintos.values()].map(c => c.join('.')).join(' o ')}.`);
        if (distintos.size === 1) return [...distintos.values()][0];
        const siguiente = [];
        for (const nodo of nivel) {
            for (const paso of modelo.grafo.get(nodo.entidad.id) || []) {
                if (nodo.visitadas.has(paso.destino.id)) continue;
                const distancia = nodo.camino.length + 1;
                const previa = distancias.get(paso.destino.id);
                if (previa != null && previa < distancia) continue;
                if (previa === distancia && cantidades.get(paso.destino.id) >= 2) continue;
                distancias.set(paso.destino.id, distancia);
                cantidades.set(paso.destino.id, previa === distancia ? cantidades.get(paso.destino.id) + 1 : 1);
                siguiente.push({ entidad: paso.destino, camino: [...nodo.camino, paso.propiedad],
                    visitadas: new Set([...nodo.visitadas, paso.destino.id]) });
            }
        }
        nivel = siguiente;
    }
    error(`no puedo resolver "${etiqueta}": no hay relación entre ${modulo.name} y ${titular.name}. Agrega la relación o usa el alcance "todos".`);
}

const vacia = () => ({ acciones: [], alcance: 'ninguno', camino: [], entidadTitular: null, campoId: null, tipoId: null });
const completa = acciones => ({ ...vacia(), acciones: [...acciones], alcance: 'todos' });

/** Una política resuelta compartida por Spring y Flutter. null conserva compatibilidad; [] cierra módulos del negocio. */
export function permisosDe(entidades = [], relaciones = [], reglasCrudas = null) {
    const reales = entidades.filter(e => !esAuxiliar(e) && nombreComparable(e.name) !== 'permisos');
    const modulos = reales.filter(e => !esAbstracta(e));
    const nombres = new Map();
    for (const e of modulos) {
        const normal = nombreComparable(e.name);
        if (nombres.has(normal)) error(`el módulo ${e.name} tiene un nombre duplicado o equivalente a ${nombres.get(normal).name}.`);
        nombres.set(normal, e);
    }
    const explicito = reglasCrudas != null;
    if (explicito && !Array.isArray(reglasCrudas)) error('la política debe ser una lista de reglas.');
    const detectados = detectarRoles(modulos);
    const vistos = new Set();
    for (const rol of detectados) {
        if (vistos.has(rol.rol)) error(`el rol ${rol.rol} corresponde a más de una clase.`);
        vistos.add(rol.rol);
    }
    let roles = detectados.map(r => ({ ...r, administrador: r.administrador === true || (r.clase == null && r.rol === 'ADMIN') }));
    if (explicito) {
        // ADMIN es infraestructura reservada; una clase Admin sigue siendo un módulo de dominio.
        roles = roles.filter(r => r.rol !== 'ADMIN').map(r => ({ ...r, gestor: false, administrador: false }));
        roles.push({ clase: null, rol: 'ADMIN', gestor: true, administrador: true });
    }
    const porRol = Object.fromEntries(roles.map(r => [r.rol, Object.fromEntries(modulos.map(e =>
        [e.name, explicito && !r.administrador ? vacia() : completa(r.gestor ? ACCIONES : ['ver'])]))]));
    if (!explicito) return { explicito, roles, porRol };
    const modelo = grafoJpa(reales, relaciones);
    const repetidas = new Set();
    for (const [indice, bruta] of reglasCrudas.entries()) {
        const regla = leerRegla(bruta, indice);
        const rol = roles.find(r => r.rol === regla.rol);
        if (!rol) error(`rol desconocido "${regla.rol}". Roles disponibles: ${roles.map(r => r.rol).join(', ')}.`);
        const modulo = nombres.get(nombreComparable(regla.modulo));
        if (!modulo) error(`módulo desconocido "${regla.modulo}". Debe ser una entidad concreta del diagrama.`);
        const clave = JSON.stringify([rol.rol, modulo.name]);
        if (repetidas.has(clave)) error(`regla duplicada para ${rol.rol}: ${modulo.name}.`);
        repetidas.add(clave);
        if (rol.administrador && (regla.alcance !== 'todos' || ACCIONES.some(a => !regla.acciones.includes(a)))) {
            error('ADMIN es el administrador de infraestructura y conserva todo/todos; usa un rol de negocio para permisos limitados.');
        }
        let resuelta = { ...vacia(), acciones: regla.acciones, alcance: regla.alcance };
        if (['propios', 'asignados'].includes(regla.alcance)) {
            const titular = reales.find(e => e.name === rol.clase);
            if (!titular) error(`el rol ${rol.rol} no tiene entidad titular para alcance ${regla.alcance}.`);
            const camino = resolverCamino(modulo, titular, regla, modelo);
            if (regla.acciones.includes('crear') && camino.length &&
                modelo.grafo.get(modulo.id).find(p => p.propiedad === camino[0])?.editable === false) {
                error(`no se puede crear ${modulo.name} con alcance ${regla.alcance}: ${modulo.name}.${camino[0]} es una colección inversa uno a muchos que el formulario no puede asignar. Usa una relación editable o retira la acción crear.`);
            }
            resuelta = { ...resuelta, camino, entidadTitular: titular.name, ...modelo.claveDe(titular) };
        }
        porRol[rol.rol][modulo.name] = resuelta;
        if (regla.acciones.some(a => a !== 'ver')) rol.gestor = true;
    }
    return { explicito, roles, porRol };
}
