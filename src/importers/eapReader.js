/**
 * Lectura de proyectos de Enterprise Architect (.EAP).
 *
 * Un .EAP es una base de datos Jet/Access con el repositorio de EA: al guardar,
 * EA escribe ahí las clases, sus atributos y operaciones, los conectores y la
 * posición de cada elemento en cada diagrama. Se lee con mdb-reader (JavaScript
 * puro: sin drivers ODBC ni conexión a internet) y se devuelve un modelo
 * intermedio. El frontend elige qué diagrama importar y arma el tablero.
 */
import MDBReader from 'mdb-reader';

export class ErrorEAP extends Error {
    constructor(mensaje) {
        super(mensaje);
        this.statusCode = 400;
    }
}

const TIPOS_CLASIFICADOR = new Set(['Class', 'Interface', 'Enumeration']);
const TIPOS_CONECTOR = new Set([
    'Association', 'Aggregation', 'Composition',
    'Generalization', 'Realisation', 'Realization', 'Dependency',
]);
const TABLAS_REQUERIDAS = ['t_object', 't_package', 't_connector', 't_attribute', 't_diagram', 't_diagramobjects'];
const VISIBILIDADES = ['public', 'private', 'protected', 'package'];

const texto = (v) => (v == null ? '' : String(v).trim());
const entero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const verdadero = (v) => v === true || v === 1 || texto(v) === '1' || texto(v).toLowerCase() === 'true';
const visibilidad = (scope, porDefecto) => {
    const s = texto(scope).toLowerCase();
    return VISIBILIDADES.includes(s) ? s : porDefecto;
};
const porPosicion = (a, b) => entero(a.pos) - entero(b.pos);

const agrupar = (lista, clave) => {
    const mapa = new Map();
    for (const item of lista) {
        const k = clave(item);
        if (!mapa.has(k)) mapa.set(k, []);
        mapa.get(k).push(item);
    }
    return mapa;
};

/**
 * @param {Buffer} buffer contenido del archivo .EAP
 * @returns {{paquetes: Array, clases: Array, conectores: Array, diagramas: Array}}
 */
export function leerModeloEAP(buffer) {
    let reader;
    try {
        reader = new MDBReader(buffer);
    } catch {
        throw new ErrorEAP('El archivo no es un proyecto de Enterprise Architect (.EAP) válido.');
    }

    const tablas = new Set(reader.getTableNames());
    const faltan = TABLAS_REQUERIDAS.filter((t) => !tablas.has(t));
    if (faltan.length) {
        throw new ErrorEAP(`El archivo no parece un proyecto de Enterprise Architect: faltan las tablas ${faltan.join(', ')}.`);
    }

    // Jet no distingue mayúsculas en los nombres de columna y las versiones de
    // EA no siempre coinciden: se normalizan a minúsculas.
    const filas = (nombre) => {
        if (!tablas.has(nombre)) return [];
        return reader.getTable(nombre).getData().map((fila) =>
            Object.fromEntries(Object.entries(fila).map(([k, v]) => [k.toLowerCase(), v]))
        );
    };

    const paquetes = filas('t_package').map((p) => ({
        id: entero(p.package_id),
        nombre: texto(p.name),
        padre: entero(p.parent_id),
    }));
    const nombrePaquete = new Map(paquetes.map((p) => [p.id, p.nombre]));

    const objetos = filas('t_object').filter((o) => TIPOS_CLASIFICADOR.has(texto(o.object_type)));
    const idsClase = new Set(objetos.map((o) => entero(o.object_id)));

    const atributosPorClase = agrupar(
        filas('t_attribute').filter((a) => idsClase.has(entero(a.object_id))),
        (a) => entero(a.object_id)
    );
    const operacionesPorClase = agrupar(
        filas('t_operation').filter((op) => idsClase.has(entero(op.object_id))),
        (op) => entero(op.object_id)
    );
    const parametrosPorOperacion = agrupar(filas('t_operationparams'), (p) => entero(p.operationid));

    const clases = objetos.map((o) => {
        const id = entero(o.object_id);
        return {
            id,
            tipo: texto(o.object_type),
            nombre: texto(o.name) || `Clase${id}`,
            abstracta: verdadero(o.abstract),
            estereotipo: texto(o.stereotype).toLowerCase(),
            paquete: entero(o.package_id),
            atributos: (atributosPorClase.get(id) || []).sort(porPosicion).map((a) => ({
                nombre: texto(a.name),
                visibilidad: visibilidad(a.scope, 'private'),
                tipo: texto(a.type),
                valorPorDefecto: texto(a.default) || null,
                estereotipo: texto(a.stereotype).toLowerCase(),
            })),
            operaciones: (operacionesPorClase.get(id) || []).sort(porPosicion).map((op) => ({
                nombre: texto(op.name),
                visibilidad: visibilidad(op.scope, 'public'),
                tipoRetorno: texto(op.type) || 'void',
                abstracta: verdadero(op.abstract),
                parametros: (parametrosPorOperacion.get(entero(op.operationid)) || [])
                    // El retorno ya está en t_operation.Type
                    .filter((p) => texto(p.kind).toLowerCase() !== 'return')
                    .sort(porPosicion)
                    .map((p) => ({ nombre: texto(p.name) || 'param', tipo: texto(p.type) })),
            })),
        };
    });

    const conectores = filas('t_connector')
        .filter((c) =>
            TIPOS_CONECTOR.has(texto(c.connector_type)) &&
            idsClase.has(entero(c.start_object_id)) &&
            idsClase.has(entero(c.end_object_id))
        )
        .map((c) => ({
            id: entero(c.connector_id),
            tipo: texto(c.connector_type),
            subtipo: texto(c.subtype),
            nombre: texto(c.name),
            origen: entero(c.start_object_id),
            destino: entero(c.end_object_id),
            cardOrigen: texto(c.sourcecard),
            cardDestino: texto(c.destcard),
            rolOrigen: texto(c.sourcerole),
            rolDestino: texto(c.destrole),
            // 0 = ninguno, 1 = agregación, 2 = composición; marca el extremo "todo" (rombo)
            agregadoOrigen: entero(c.sourceisaggregate),
            agregadoDestino: entero(c.destisaggregate),
        }));

    const objetosPorDiagrama = agrupar(
        filas('t_diagramobjects').filter((d) => idsClase.has(entero(d.object_id))),
        (d) => entero(d.diagram_id)
    );
    const ocultosPorDiagrama = agrupar(
        filas('t_diagramlinks').filter((l) => verdadero(l.hidden)),
        (l) => entero(l.diagramid)
    );

    const diagramas = filas('t_diagram')
        .map((d) => {
            const id = entero(d.diagram_id);
            return {
                id,
                nombre: texto(d.name) || `Diagrama ${id}`,
                tipo: texto(d.diagram_type),
                paquete: entero(d.package_id),
                nombrePaquete: nombrePaquete.get(entero(d.package_id)) || '',
                // En la base de EA la coordenada Y se guarda en negativo
                objetos: (objetosPorDiagrama.get(id) || []).map((o) => ({
                    clase: entero(o.object_id),
                    left: entero(o.rectleft),
                    top: Math.abs(entero(o.recttop)),
                    right: entero(o.rectright),
                    bottom: Math.abs(entero(o.rectbottom)),
                })),
                conectoresOcultos: (ocultosPorDiagrama.get(id) || []).map((l) => entero(l.connectorid)),
            };
        })
        .filter((d) => d.objetos.length > 0);

    return { paquetes, clases, conectores, diagramas };
}

export default leerModeloEAP;
