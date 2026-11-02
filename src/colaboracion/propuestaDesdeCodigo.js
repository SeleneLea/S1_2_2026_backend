/**
 * Código -> diagrama: lo que trae el navegador al importar un proyecto Spring Boot
 * (frontend/src/utils/importarCodigo.js) se convierte en una PROPUESTA, como un cambio de la IA:
 * se ve en la pizarra y cualquiera del equipo la acepta o rechaza.
 *
 * El navegador no manda el diagrama completo sino solo lo que cambia (clases y relaciones nuevas o
 * modificadas, y las que hay que quitar si se pidió). Aquí se aplica sobre el diagrama ACTUAL del
 * servidor: si mientras tanto alguien agregó una clase, la propuesta no la borra.
 */

const MAX_NODOS = 300;
const MAX_ARISTAS = 600;
const TIPOS_RELACION = new Set(['Association', 'Aggregation', 'Composition', 'Generalization', 'Implementation', 'Dependency', 'AssociationClassConnection']);

const texto = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const id = (v) => (typeof v === 'string' && /^[\w:.-]{1,120}$/.test(v) ? v : null);
const listaDeTextos = (v, max = 100, largo = 200) => (Array.isArray(v) ? v.slice(0, max).map((x) => texto(x, largo)).filter(Boolean) : []);

/** Solo los campos que el diagrama usa, acotados. */
const nodoValido = (n) => {
    const nodoId = id(n?.id);
    const nombre = texto(n?.data?.className, 120).trim();
    if (!nodoId || n?.type !== 'classNode' || !nombre) return null;
    const d = n.data;
    return {
        id: nodoId,
        type: 'classNode',
        position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 },
        data: {
            className: nombre,
            attributes: listaDeTextos(d.attributes),
            methods: listaDeTextos(d.methods),
            ...(d.stereotype ? { stereotype: texto(d.stereotype, 40) } : {}),
            ...(d.isAssociationClass ? { isAssociationClass: true, associatedEdgeId: id(d.associatedEdgeId) } : {}),
        },
    };
};

const aristaValida = (e) => {
    const aristaId = id(e?.id);
    const source = id(e?.source);
    const target = id(e?.target);
    const tipo = e?.data?.type;
    if (!aristaId || !source || !target || !TIPOS_RELACION.has(tipo)) return null;
    const d = e.data;
    return {
        id: aristaId, source, target, type: 'umlEdge',
        data: {
            type: tipo,
            startLabel: texto(d.startLabel, 20),
            endLabel: texto(d.endLabel, 20),
            ...(d.label ? { label: texto(d.label, 120) } : {}),
            ...(d.hasAssociationClass ? { hasAssociationClass: true, associationClassNodeId: id(d.associationClassNodeId) } : {}),
            ...(d.isAssociationConnection ? { isAssociationConnection: true, parentRelationId: id(d.parentRelationId) } : {}),
        },
    };
};

/**
 * El diagrama propuesto: el actual del servidor con los cambios del código aplicados encima.
 * @returns {{ propuesto: {nodes, edges} } | { error: string }}
 */
export const diagramaPropuestoDesdeCodigo = (estado, cambios = {}) => {
    const nodosIn = Array.isArray(cambios.nodos) ? cambios.nodos : [];
    const aristasIn = Array.isArray(cambios.aristas) ? cambios.aristas : [];
    if (nodosIn.length > MAX_NODOS || aristasIn.length > MAX_ARISTAS) return { error: 'El proyecto es demasiado grande para importarlo de una vez.' };
    const nodos = nodosIn.map(nodoValido).filter(Boolean);
    const aristas = aristasIn.map(aristaValida).filter(Boolean);
    const quitarNodos = new Set((Array.isArray(cambios.quitarNodos) ? cambios.quitarNodos : []).map(id).filter(Boolean));
    const quitarAristas = new Set((Array.isArray(cambios.quitarAristas) ? cambios.quitarAristas : []).map(id).filter(Boolean));

    const actuales = estado?.nodes || [];
    const porId = new Map(nodos.map((n) => [n.id, n]));
    // Clases que ya existen: cambia su contenido (atributos, estereotipo), no su lugar en la pizarra
    const nodes = actuales
        .filter((n) => !(quitarNodos.has(n.id) && n.type === 'classNode'))
        .map((n) => (porId.has(n.id) && n.type === 'classNode' ? { ...n, data: { ...n.data, ...porId.get(n.id).data } } : n));
    const ids = new Set(nodes.map((n) => n.id));
    for (const n of nodos) if (!ids.has(n.id)) { nodes.push(n); ids.add(n.id); }

    const aristaPorId = new Map(aristas.map((e) => [e.id, e]));
    const edges = (estado?.edges || [])
        .filter((e) => !quitarAristas.has(e.id) && ids.has(e.source) && ids.has(e.target))
        .map((e) => (aristaPorId.has(e.id) ? { ...e, data: { ...e.data, ...aristaPorId.get(e.id).data } } : e));
    const idsAristas = new Set(edges.map((e) => e.id));
    for (const e of aristas) if (!idsAristas.has(e.id) && ids.has(e.source) && ids.has(e.target)) { edges.push(e); idsAristas.add(e.id); }
    return { propuesto: { nodes, edges } };
};

export default diagramaPropuestoDesdeCodigo;
