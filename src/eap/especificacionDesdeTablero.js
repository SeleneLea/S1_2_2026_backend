/**
 * Tablero del diagramador → especificación para preparar-plan.mjs.
 *
 * El plan resultante lo escribe escribir-eap.ps1 en una copia de la plantilla Jet 3, con las filas
 * que Enterprise Architect 13 guarda al dibujar a mano: al abrir el .EAP el diagrama de clases
 * aparece armado en el lienzo, con las mismas posiciones que en el tablero.
 */

const TIPO_RELACION = {
    association: 'asociacion',
    aggregation: 'agregacion',
    composition: 'composicion',
    generalization: 'generalizacion',
    inheritance: 'generalizacion',
    realization: 'realizacion',
    realisation: 'realizacion',
    implementation: 'realizacion',
    dependency: 'dependencia',
};

const esClaseDelTablero = (n) =>
    n && n.type === 'classNode' && n.data?.className && !n.data?.isConnectionPoint && !n.data?.isNote;

const esRelacionDelTablero = (e) =>
    e && !e.data?.isAssociationConnection && !e.data?.isNoteConnection;

/** Las restricciones {unico}, {opcional}… son para el generador de código: en EA sobran en el nombre. */
const sinRestricciones = (texto) => String(texto ?? '').replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();

const textoMiembro = (miembro) => {
    if (typeof miembro === 'string') return sinRestricciones(miembro);
    if (miembro && typeof miembro === 'object') {
        const nombre = miembro.name ?? miembro.nombre ?? '';
        const tipo = miembro.type ?? miembro.tipo ?? '';
        return sinRestricciones(tipo ? `${nombre}: ${tipo}` : nombre);
    }
    return '';
};

const tipoDeElemento = (estereotipo) => {
    if (estereotipo === 'interface') return 'interfaz';
    if (estereotipo === 'enumeration') return 'enumeracion';
    return 'clase';
};

/**
 * @param {{nodes: object[], edges: object[]}} tablero  lo que guarda el editor
 * @param {string} titulo  nombre del tablero: es el paquete del modelo en EA
 */
export const especificacionDesdeTablero = (tablero, titulo) => {
    const nodos = (tablero?.nodes || []).filter(esClaseDelTablero);
    if (!nodos.length) {
        throw Object.assign(new Error('El diagrama no tiene clases para exportar a Enterprise Architect.'), { statusCode: 400 });
    }

    // EA no admite dos elementos con el mismo id en la especificación: se usa el id del nodo
    const ids = new Set(nodos.map((n) => n.id));
    // El lienzo de EA empieza en (0,0): se corre todo para que nada quede en negativo
    const minX = Math.min(...nodos.map((n) => n.position?.x ?? 0));
    const minY = Math.min(...nodos.map((n) => n.position?.y ?? 0));
    const MARGEN = 30;

    const elementos = nodos.map((n) => {
        const estereotipo = n.data?.stereotype || null;
        const tipo = tipoDeElemento(estereotipo);
        const ancho = Math.round(n.measured?.width ?? n.width ?? 0);
        const alto = Math.round(n.measured?.height ?? n.height ?? 0);
        const elemento = {
            id: n.id,
            tipo,
            nombre: String(n.data.className).trim(),
            x: Math.round((n.position?.x ?? 0) - minX + MARGEN),
            y: Math.round((n.position?.y ?? 0) - minY + MARGEN),
            atributos: (n.data?.attributes || []).map(textoMiembro).filter(Boolean),
            operaciones: tipo === 'enumeracion' ? [] : (n.data?.methods || []).map(textoMiembro).filter(Boolean),
        };
        if (estereotipo === 'abstract' || n.data?.isAbstract) elemento.abstracta = true;
        // El tamaño lo calcula el plan según los miembros si el tablero no lo guardó
        if (ancho > 40) elemento.ancho = ancho;
        if (alto > 30) elemento.alto = alto;
        return elemento;
    });

    const relaciones = (tablero?.edges || [])
        .filter(esRelacionDelTablero)
        .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
        .map((e) => {
            const tipo = TIPO_RELACION[String(e.data?.type || 'Association').toLowerCase()] || 'asociacion';
            const relacion = { tipo, desde: e.source, hacia: e.target };
            const nombre = String(e.data?.label ?? '').trim();
            if (nombre) relacion.nombre = nombre;
            // En el editor el rombo va en el destino (el todo), igual que en la especificación
            if (tipo === 'asociacion' || tipo === 'agregacion' || tipo === 'composicion') {
                const origen = String(e.data?.startLabel ?? '').trim();
                const destino = String(e.data?.endLabel ?? '').trim();
                if (origen) relacion.multOrigen = origen;
                if (destino) relacion.multDestino = destino;
                const rolOrigen = String(e.data?.sourceRole ?? '').trim();
                const rolDestino = String(e.data?.targetRole ?? '').trim();
                if (rolOrigen) relacion.rolOrigen = rolOrigen;
                if (rolDestino) relacion.rolDestino = rolDestino;
            }
            return relacion;
        });

    const modelo = String(titulo || 'Modelo UML').trim() || 'Modelo UML';
    return {
        modelo,
        autor: 'Diagramador UML',
        diagramas: [{
            tipo: 'clases',
            nombre: `Diagrama de clases - ${modelo}`,
            paquete: 'Modelo de clases',
            disposicion: 'manual',
            elementos,
            relaciones,
        }],
    };
};
