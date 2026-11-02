/**
 * La IA de la sala: un solo integrante más del equipo, compartido por todos (RF-01 a RF-10).
 *
 * - Atiende un pedido a la vez por sala (cola), siempre sobre el diagrama actual.
 * - Recibe el contexto del equipo: diagrama, memoria de sesiones anteriores, conversación reciente,
 *   quién hizo cada cambio y quién le está hablando.
 * - Nunca toca el modelo por su cuenta: los cambios que pide alguien salen como PROPUESTA, que
 *   cualquier integrante acepta o rechaza. Las ideas sí se pegan como notas en la pizarra.
 * - Proveedores: Gemini → DeepSeek → IA local (Ollama), con el pedido en texto plano.
 */
import AIEditorController from '../controllers/ai.editor.controller.js';
import { conCandado } from './candado.js';
import { extraerJSON, textoLegible } from './jsonIA.js';
import { diagramaPropuestoDesdeCodigo } from './propuestaDesdeCodigo.js';
import {
    aplicarOperaciones, describirOperacion, diagramaComoTexto, nombresPorId, operacionesPropuestas,
} from './diagramaSemantico.js';
import {
    actualizarDatosMensaje, cerrarPropuesta, contarMensajesDesde, guardarMemoria, guardarMensaje,
    guardarPropuesta, leerMemoria, listarCambios, listarMensajes, mensajesDesde, obtenerPropuesta,
    finalizarPropuesta, reservarPropuesta, integrantesDeSala, reabrirPropuesta,
} from './repositorio.js';

export const NOMBRE_IA = 'IA';
const MENSAJES_PARA_RESUMIR = Number(process.env.IA_MENSAJES_PARA_RESUMIR || 30);

/**
 * Lo que la IA necesita del servidor de tiempo real. Se configura al arrancar (index.js).
 * - emitir(salaId, evento, datos): a toda la sala
 * - estadoActual(salaId): diagrama actual { nodes, edges }
 * - conectados(salaId): nombres de quienes están en la sala
 * - aplicarEstado(salaId, estado, autor): reemplaza el diagrama, lo guarda y lo envía a todos
 */
let servidor = {
    emitir: () => {},
    estadoActual: async () => ({ nodes: [], edges: [] }),
    conectados: () => [],
    aplicarEstado: async () => {},
    estadoEnMemoria: () => null,
    activarSala: async () => {},
    aplicarYGuardar: async () => ({ aplicada: false, error: new Error('Servidor no configurado') }),
    aplicarOpsSala: async () => {},
    alResponder: () => {},
};
export const configurarIA = (funciones) => { servidor = { ...servidor, ...funciones }; };

/** salaId → { cola: Promise, enCola: number, atendiendo: string|null } */
const colas = new Map();

export const estadoIA = (salaId) => {
    const c = colas.get(salaId);
    return { ocupada: !!c?.atendiendo, atendiendoA: c?.atendiendo || null, enCola: c?.enCola || 0 };
};

const avisarEstado = (salaId) => servidor.emitir(salaId, 'ia:estado', estadoIA(salaId));

const nombreProveedor = (modelo = '') => {
    if (/deepseek/i.test(modelo)) return 'DeepSeek';
    if (/ollama/i.test(modelo)) return 'IA local';
    return 'Gemini';
};

const modelos = () => String(process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || 'gemini-2.5-flash')
    .split(',').map((s) => s.trim()).filter(Boolean);

/** Para conversar y clasificar el pedido alcanza un modelo rápido; el editor usa los de siempre. */
const modelosRapidos = () => String(process.env.IA_SALA_MODELS || 'gemini-2.5-flash-lite,gemini-flash-lite-latest,gemini-2.5-flash')
    .split(',').map((s) => s.trim()).filter(Boolean);

/** Pedido de texto con toda la cadena de respaldo (Gemini → DeepSeek → Ollama). */
const generar = (prompt, rapido = true) => AIEditorController._generateUsingModels(rapido ? modelosRapidos() : modelos(), prompt);

const hora = (fecha) => new Date(fecha).toLocaleString('es-BO', {
    timeZone: process.env.ZONA_HORARIA || 'America/La_Paz', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

const autorDeCambio = (c) => (c.esIA
    ? `la IA (pedido por ${c.pedidoPor || '?'}${c.aprobadoPor ? `, aprobado por ${c.aprobadoPor}` : ''})`
    : c.autorNombre || 'alguien');

const PROMPT_IA = `Eres "IA", un integrante más de un equipo que diseña un diagrama de clases UML en una pizarra compartida.
Varias personas trabajan a la vez y todas leen tus respuestas (es un chat de grupo, no hay conversaciones privadas).
Eres desarrollador, moderador, asesor y consultor del equipo. Reglas:
- Solo actúas cuando te lo piden. Respondes al pedido actual; usa la conversación y el historial como contexto.
- Dirígete a la persona por su nombre. Responde en español, claro y breve (máximo ~10 líneas), con Markdown simple.
- Sabes quién hizo cada cambio gracias al historial: úsalo si preguntan qué hizo alguien o qué pasó.
- Si te piden cambiar el diagrama (agregar, quitar, renombrar o modificar clases, atributos, métodos o relaciones),
  NO digas que ya lo hiciste: tus cambios son una PROPUESTA que el equipo acepta o rechaza en la pizarra.
- En una revisión señala errores reales de diseño (claves, multiplicidades, nombres, relaciones mal tipadas,
  clases sin atributos, redundancias) indicando la clase exacta.
- Las ideas deben ser concretas y aplicables a este diagrama.

Devuelve SOLO un JSON válido, sin texto fuera de él, con esta forma:
{
  "tipo": "respuesta" | "cambios" | "revision" | "idea",
  "texto": "lo que dices al grupo",
  "instruccionCambios": "solo si tipo=cambios: la instrucción exacta y completa para el editor del diagrama",
  "observaciones": [ { "clase": "NombreExacto", "gravedad": "error" | "aviso" | "sugerencia", "texto": "..." } ],
  "ideas": [ { "titulo": "corto", "texto": "la idea en 1 a 3 frases", "clase": "NombreExacto o vacío" } ]
}
Usa "cambios" cuando el pedido implica modificar el diagrama; "revision" para revisar o corregir;
"idea" cuando piden ideas o propuestas de diseño (no cambios directos); "respuesta" para preguntas,
dudas teóricas, resúmenes de lo que hizo el equipo y todo lo demás.`;

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Integrantes nombrados en el pedido ("revisa lo de Ana"): nombre completo, o el primero si es único. */
const mencionados = (texto, integrantes) => {
    const t = ` ${sinTildes(texto).replace(/[^a-z0-9ñ ]/g, ' ')} `;
    const primeros = integrantes.map((u) => sinTildes(u.name).split(/\s+/)[0]);
    return integrantes.filter((u, i) => {
        const completo = sinTildes(u.name).trim();
        const primero = primeros[i];
        const unico = primero && primeros.filter((x) => x === primero).length === 1;
        return (completo && t.includes(` ${completo} `)) || (unico && primero.length > 2 && t.includes(` ${primero} `));
    }).slice(0, 3);
};

const armarContexto = async (salaId, pedido, quien, propuestaAAjustar = null) => {
    const [estado, memoria, mensajes, cambios, integrantes] = await Promise.all([
        servidor.estadoActual(salaId),
        leerMemoria(salaId),
        listarMensajes(salaId, { limite: 30 }),
        listarCambios(salaId, { limite: 40 }),
        integrantesDeSala(salaId),
    ]);
    // Para revisar el trabajo de una persona hace falta todo lo suyo, no solo lo reciente
    const trabajos = await Promise.all(mencionados(pedido.texto, integrantes).map(async (u) => {
        const TOPE = 2000;
        const suyos = await listarCambios(salaId, { limite: TOPE, autor: u.name });
        if (!suyos.length) return `${u.name} todavía no hizo cambios en el diagrama.`;
        const titulo = suyos.length >= TOPE
            ? `LOS ÚLTIMOS ${TOPE} CAMBIOS DE ${u.name.toUpperCase()} (hizo más; los anteriores no entran)`
            : `TODO LO QUE HIZO ${u.name.toUpperCase()}: ${suyos.length} cambio${suyos.length === 1 ? '' : 's'} (del más viejo al más nuevo)`;
        return `${titulo}:\n${suyos.map((c) => `[${hora(c.creadoEn)}] ${c.resumen}`).join('\n')}`;
    }));
    const conversacion = mensajes
        .filter((m) => m.id !== pedido.id)
        .map((m) => `[${hora(m.creadoEn)}] ${m.tipo === 'ia' ? NOMBRE_IA : m.tipo === 'sistema' ? 'Sistema' : m.autorNombre}: ${m.texto.slice(0, 600)}`)
        .join('\n');
    const historial = cambios.map((c) => `[${hora(c.creadoEn)}] ${autorDeCambio(c)} ${c.resumen}`).join('\n');
    const conectados = servidor.conectados(salaId);
    const ajuste = propuestaAAjustar
        ? `\n\nPROPUESTA PENDIENTE QUE TE PIDEN AJUSTAR (pedida por ${propuestaAAjustar.pedidoPorNombre}):
Instrucción original: ${propuestaAAjustar.instruccion}
Cambios que proponía:\n${(propuestaAAjustar.resumen || []).map((r) => `- ${r}`).join('\n')}
Responde con tipo "cambios" y una instruccionCambios COMPLETA que ya incluya el ajuste (reemplaza a la anterior).`
        : '';
    const texto = `${PROMPT_IA}

SALA: "${memoria.titulo}"
CONECTADOS AHORA: ${conectados.length ? conectados.join(', ') : '(nadie más)'}
FECHA Y HORA: ${hora(new Date())}

MEMORIA DE SESIONES ANTERIORES:
${memoria.resumen || '(todavía no hay resumen)'}

DIAGRAMA ACTUAL:
${diagramaComoTexto(estado)}

HISTORIAL DE CAMBIOS (quién hizo qué, del más viejo al más nuevo):
${historial || '(sin cambios registrados)'}
${trabajos.length ? `\n${trabajos.join('\n\n')}\n` : ''}

CONVERSACIÓN RECIENTE DEL GRUPO:
${conversacion || '(sin mensajes)'}

PEDIDO ACTUAL de ${quien}:
${pedido.texto}${ajuste}`;
    return { texto, estado };
};

/** El editor de IA existente calcula el diagrama nuevo; aquí solo se usa para proponer. */
const calcularEdicion = async (instruccion, estado, imagen = null) => {
    const clases = (estado.nodes || []).filter((n) => n.type === 'classNode' && !n.data?.isConnectionPoint);
    // El editor lee la multiplicidad de data.cardinality: el tablero la guarda en las etiquetas
    const aristas = (estado.edges || []).map((e) => (e.data?.cardinality || !(e.data?.startLabel || e.data?.endLabel) ? e : {
        ...e, data: { ...e.data, cardinality: `${e.data.startLabel || '1'}:${e.data.endLabel || '1'}` },
    }));
    const pedido = `${instruccion}

Nota: el resultado es una PROPUESTA que el equipo revisará antes de aplicarla, así que no hagas preguntas
de aclaración (deja clarifyingQuestions vacío) salvo que el pedido sea imposible de entender: usa supuestos
razonables y conserva todo lo que no se pide cambiar.`;
    let cuerpo = null;
    let codigo = 200;
    const res = {
        status(c) { codigo = c; return this; },
        json(b) { cuerpo = b; return this; },
    };
    const files = imagen ? { image: [{ buffer: imagen.buffer, mimetype: imagen.tipo }] } : null;
    await AIEditorController.modifyDiagram({ body: { prompt: pedido, nodes: clases, edges: aristas }, files }, res);
    if (codigo >= 400 || !cuerpo?.success) throw new Error(cuerpo?.error || 'El editor de IA no pudo calcular los cambios');
    return cuerpo;
};

const publicarMensajeIA = async (salaId, texto, datos) => {
    const mensaje = await guardarMensaje({ salaId, autorNombre: NOMBRE_IA, tipo: 'ia', texto, datos });
    servidor.emitir(salaId, 'chat:nuevo', mensaje);
    return mensaje;
};

/** Notas en la pizarra con las ideas de la IA, junto a la clase que mencionan. */
const pegarIdeas = async (salaId, ideas, quien) => {
    const estado = await servidor.estadoActual(salaId);
    const clases = (estado.nodes || []).filter((n) => n.type === 'classNode');
    const posiciones = (estado.nodes || []).map((n) => n.position || { x: 0, y: 0 });
    const xLibre = posiciones.length ? Math.max(...posiciones.map((p) => p.x || 0)) + 450 : 100;
    const notas = ideas.map((idea, i) => {
        const clase = idea.clase && clases.find((n) => String(n.data?.className || '').toLowerCase() === String(idea.clase).toLowerCase());
        return {
            id: `nota-ia-${Date.now()}-${i}`,
            type: 'noteNode',
            position: clase
                ? { x: (clase.position?.x || 0) + i * 30, y: (clase.position?.y || 0) - 200 - i * 30 }
                : { x: xLibre, y: 60 + i * 170 },
            data: { text: `💡 Idea de la IA (pedida por ${quien})\n${idea.titulo ? `${idea.titulo}: ` : ''}${idea.texto}`, isNote: true, deIA: true },
        };
    });
    if (!notas.length) return [];
    // Solo se agregan las notas (operaciones), sin reemplazar el diagrama leído antes
    await conCandado(salaId, () => servidor.aplicarOpsSala(salaId, notas.map((nodo) => ({ op: 'ponerNodo', nodo })),
        { esIA: true, nombre: NOMBRE_IA, pedidoPor: quien }));
    return notas.map((n) => n.id);
};

const atender = async (salaId, pedido, autor, extras = {}) => {
    const quien = autor.nombre || 'alguien';
    // "Pedir ajuste": la propuesta anterior se rehace con el ajuste y queda reemplazada
    const idAjuste = Number(pedido.datos?.ajusta);
    const aAjustar = idAjuste ? await obtenerPropuesta(idAjuste) : null;
    const propuestaAAjustar = aAjustar && aAjustar.salaId === salaId && aAjustar.estado === 'pendiente' ? aAjustar : null;
    const { texto: contexto, estado } = await armarContexto(salaId, pedido, quien, propuestaAAjustar);
    const imagen = extras.imagen || null;
    const prompt = imagen
        ? [`${contexto}\n\nIMAGEN ADJUNTA por ${quien}: una foto o captura (diagrama dibujado, pizarra, apunte). Úsala para responder; si piden pasarla al diagrama, el tipo es "cambios".`,
            { inlineData: { mimeType: imagen.tipo, data: imagen.buffer.toString('base64') } }]
        : contexto;
    const { model, text } = await generar(prompt);
    const proveedor = nombreProveedor(model);
    // Si no se pudo leer como JSON se responde con su texto, nunca con el JSON crudo
    const r = extraerJSON(text) || { tipo: 'respuesta', texto: textoLegible(text) };
    const tipo = propuestaAAjustar ? 'cambios' : (['respuesta', 'cambios', 'revision', 'idea'].includes(r.tipo) ? r.tipo : 'respuesta');
    const decir = String(r.texto || '').trim() || 'Listo.';
    const base = { proveedor, respondeA: pedido.id, pedidoPor: quien, tipoRespuesta: tipo };

    if (tipo === 'cambios') {
        const instruccion = String(r.instruccionCambios
            || (propuestaAAjustar ? `${propuestaAAjustar.instruccion}\nAjuste pedido por ${quien}: ${pedido.texto}` : pedido.texto)).trim();
        const edicion = await calcularEdicion(instruccion, estado, imagen);
        const preguntasReales = (edicion.clarifyingQuestions || []).some((p) => String(typeof p === 'string' ? p : p?.question || '').includes('?'));
        if (edicion.needsClarification && preguntasReales) {
            const preguntas = (edicion.clarifyingQuestions || []).map((p) => `- ${typeof p === 'string' ? p : p.question || JSON.stringify(p)}`).join('\n');
            return publicarMensajeIA(salaId, `${quien}, antes de proponer los cambios necesito que me aclares:\n${preguntas}`, base);
        }
        if (edicion.needsClarification) {
            return publicarMensajeIA(salaId, `${decir}

_No pude calcular los cambios con ese pedido; descríbelo con un poco más de detalle._`, base);
        }
        const operaciones = operacionesPropuestas(estado, edicion.newState);
        if (!operaciones.length) {
            return publicarMensajeIA(salaId, `${decir}\n\n_No encontré nada que cambiar en el diagrama con ese pedido._`, base);
        }
        const nombreDe = nombresPorId(estado, edicion.newState);
        const resumen = operaciones.map((op) => describirOperacion(op, nombreDe));
        const mensaje = await publicarMensajeIA(salaId, decir, { ...base, propuesta: { estado: 'pendiente', cantidad: operaciones.length } });
        const propuesta = await guardarPropuesta({
            salaId, mensajeId: mensaje.id, pedidoPorId: autor.id, pedidoPorNombre: quien, instruccion, operaciones, resumen,
        });
        const actualizado = await actualizarDatosMensaje(mensaje.id, { propuesta: { id: propuesta.id, estado: 'pendiente', cantidad: operaciones.length } });
        servidor.emitir(salaId, 'chat:actualizado', actualizado);
        servidor.emitir(salaId, 'propuesta:nueva', propuesta);
        if (propuestaAAjustar) {
            const reemplazada = await cerrarPropuesta(propuestaAAjustar.id, {
                estado: 'reemplazada', decididoPorId: autor.id, decididoPorNombre: quien, motivo: `la reemplaza la propuesta ${propuesta.id}`,
            });
            if (reemplazada) {
                servidor.emitir(salaId, 'propuesta:actualizada', reemplazada);
                await reflejarEnMensaje(salaId, reemplazada);
            }
        }
        return actualizado;
    }

    if (tipo === 'revision') {
        const clases = (estado.nodes || []).filter((n) => n.type === 'classNode');
        const observaciones = (Array.isArray(r.observaciones) ? r.observaciones : []).slice(0, 15).map((o) => {
            const nodo = clases.find((n) => String(n.data?.className || '').toLowerCase() === String(o.clase || '').toLowerCase());
            return {
                clase: o.clase || '',
                nodoId: nodo?.id || null,
                gravedad: ['error', 'aviso', 'sugerencia'].includes(o.gravedad) ? o.gravedad : 'aviso',
                texto: String(o.texto || '').slice(0, 400),
            };
        });
        return publicarMensajeIA(salaId, decir, { ...base, observaciones });
    }

    if (tipo === 'idea') {
        const ideas = (Array.isArray(r.ideas) ? r.ideas : []).slice(0, 5).map((i) => ({
            titulo: String(i.titulo || '').slice(0, 80), texto: String(i.texto || '').slice(0, 400), clase: i.clase || '',
        })).filter((i) => i.texto);
        const notas = await pegarIdeas(salaId, ideas, quien);
        return publicarMensajeIA(salaId, decir, { ...base, ideas, notas });
    }

    return publicarMensajeIA(salaId, decir, base);
};

/**
 * Reescribe la memoria de la sala cuando se acumularon suficientes mensajes nuevos, para que la IA
 * recuerde el trabajo de días anteriores sin pasarse del límite de contexto (RF-09).
 */
const TANDA_MEMORIA = 200;
const actualizarMemoria = async (salaId) => {
    // Hasta 3 tandas por vez; lo que quede se resume en la próxima respuesta de la IA
    for (let vuelta = 0; vuelta < 3; vuelta += 1) {
        const memoria = await leerMemoria(salaId);
        const { cantidad } = await contarMensajesDesde(salaId, memoria.hasta);
        if (cantidad < MENSAJES_PARA_RESUMIR) return;
        const nuevos = await mensajesDesde(salaId, memoria.hasta, TANDA_MEMORIA);
        if (!nuevos.length) return;
        const cambios = await listarCambios(salaId, { limite: 80 });
        const prompt = `Eres la memoria de un equipo que diseña un diagrama de clases. Reescribe el resumen acumulado
incorporando lo nuevo. Conserva decisiones de diseño, quién hizo qué, acuerdos, pendientes y dudas abiertas.
Máximo 15 viñetas, en español. Devuelve solo el resumen, sin título.

RESUMEN ANTERIOR:
${memoria.resumen || '(vacío)'}

MENSAJES NUEVOS:
${nuevos.map((m) => `[${hora(m.creadoEn)}] ${m.tipo === 'ia' ? NOMBRE_IA : m.autorNombre || 'Sistema'}: ${m.texto.slice(0, 400)}`).join('\n')}

CAMBIOS RECIENTES DEL DIAGRAMA:
${cambios.map((c) => `[${hora(c.creadoEn)}] ${autorDeCambio(c)} ${c.resumen}`).join('\n')}`;
        const { text } = await generar(prompt, true);
        const resumen = String(text || '').trim().slice(0, 4000);
        if (!resumen) return;
        // El cursor queda en el último mensaje incluido en este resumen, no en el último de la sala
        await guardarMemoria(salaId, resumen, nuevos[nuevos.length - 1].id);
    }
};

/**
 * Encola un pedido para la IA de la sala. Responde en el chat de todos; si algo falla,
 * la IA lo dice en el chat en lugar de quedarse callada.
 * @param {object} pedido  el mensaje del integrante ya guardado
 * @param {{id: number, nombre: string}} autor
 */
/**
 * Código -> diagrama: las diferencias entre un proyecto Spring Boot importado y el diagrama quedan
 * como propuesta en el chat de la IA (vista previa en la pizarra; el equipo acepta o rechaza).
 * @param {{archivo?: string, entidades?: number}} origen  qué se importó (para el mensaje)
 */
export const proponerDesdeCodigo = async (salaId, cambios, autor, origen = {}) => {
    const quien = autor?.nombre || 'alguien';
    const estado = await servidor.estadoActual(salaId);
    const r = diagramaPropuestoDesdeCodigo(estado, cambios);
    if (r.error) return { ok: false, mensaje: r.error };
    const operaciones = operacionesPropuestas(estado, r.propuesto);
    const archivo = String(origen.archivo || 'el proyecto').slice(0, 120);
    const entidades = Number.isInteger(origen.entidades) ? origen.entidades : null;
    const deDonde = `${archivo}${entidades !== null ? `, ${entidades} entidad${entidades === 1 ? '' : 'es'}` : ''}`;
    const base = { proveedor: 'código', origen: 'codigo', pedidoPor: quien, tipoRespuesta: 'cambios' };
    if (!operaciones.length) {
        await publicarMensajeIA(salaId, `📥 ${quien} importó el código (${deDonde}): el diagrama ya coincide con el código.`, base);
        return { ok: true, sinCambios: true };
    }
    const nombreDe = nombresPorId(estado, r.propuesto);
    const resumen = operaciones.map((op) => describirOperacion(op, nombreDe));
    const n = operaciones.length;
    const mensaje = await publicarMensajeIA(salaId,
        `📥 ${quien} importó el código (${deDonde}). Hay ${n} diferencia${n === 1 ? '' : 's'} con el diagrama: quedan como propuesta para que el equipo decida.`,
        { ...base, propuesta: { estado: 'pendiente', cantidad: n } });
    const propuesta = await guardarPropuesta({
        salaId, mensajeId: mensaje.id, pedidoPorId: autor?.id ?? null, pedidoPorNombre: quien,
        instruccion: `Sincronizar el diagrama con el código (${archivo})`, operaciones, resumen,
    });
    const actualizado = await actualizarDatosMensaje(mensaje.id, { propuesta: { id: propuesta.id, estado: 'pendiente', cantidad: n } });
    servidor.emitir(salaId, 'chat:actualizado', actualizado);
    servidor.emitir(salaId, 'propuesta:nueva', propuesta);
    return { ok: true, propuestaId: propuesta.id, cantidad: n };
};

export const pedirALaIA = (salaId, pedido, autor, extras = {}) => {
    if (!colas.has(salaId)) colas.set(salaId, { cola: Promise.resolve(), enCola: 0, atendiendo: null });
    const c = colas.get(salaId);
    c.enCola += 1;
    avisarEstado(salaId);
    c.cola = c.cola.then(async () => {
        c.enCola -= 1;
        c.atendiendo = autor.nombre || 'alguien';
        avisarEstado(salaId);
        try {
            const respuesta = await atender(salaId, pedido, autor, extras);
            servidor.alResponder(salaId, respuesta, autor);
        } catch (error) {
            console.error(`IA de la sala ${salaId}:`, error.message);
            await publicarMensajeIA(salaId,
                `${autor.nombre || 'Perdón'}, no pude responder ahora: ${/exhausted|overloaded|cuota|quota/i.test(error.message)
                    ? 'las IA en la nube están sin cuota o saturadas y la IA local no está encendida'
                    : error.message}. Intenta de nuevo en un momento.`,
                { proveedor: null, respondeA: pedido.id, error: true }).catch(() => {});
        } finally {
            c.atendiendo = null;
            avisarEstado(salaId);
        }
        await actualizarMemoria(salaId).catch((e) => console.warn(`Memoria de la sala ${salaId}:`, e.message));
    });
    return c.cola;
};

const mensajeSistema = async (salaId, texto, datos = null) => {
    const m = await guardarMensaje({ salaId, tipo: 'sistema', texto, datos });
    servidor.emitir(salaId, 'chat:nuevo', m);
    return m;
};

const reflejarEnMensaje = async (salaId, propuesta) => {
    if (!propuesta.mensajeId) return;
    const m = await actualizarDatosMensaje(propuesta.mensajeId, {
        propuesta: { id: propuesta.id, estado: propuesta.estado, cantidad: propuesta.operaciones.length, decididoPor: propuesta.decididoPorNombre },
    });
    if (m) servidor.emitir(salaId, 'chat:actualizado', m);
};

/**
 * Un integrante acepta o rechaza una propuesta. La primera decisión cierra la propuesta.
 * Si alguien cambió lo que la propuesta toca, queda "desactualizada" y no se aplica nada.
 */
export const decidirPropuesta = async (salaId, propuestaId, decision, usuario) => {
    const propuesta = await obtenerPropuesta(propuestaId);
    if (!propuesta || propuesta.salaId !== salaId) return { ok: false, mensaje: 'La propuesta no existe en esta sala.' };
    if (propuesta.estado !== 'pendiente') return { ok: false, mensaje: `La propuesta ya fue ${propuesta.estado} por ${propuesta.decididoPorNombre || 'otra persona'}.` };

    if (decision === 'rechazar') {
        const cerrada = await cerrarPropuesta(propuestaId, { estado: 'rechazada', decididoPorId: usuario.id, decididoPorNombre: usuario.nombre });
        if (!cerrada) return { ok: false, mensaje: 'Otra persona ya decidió esta propuesta.' };
        servidor.emitir(salaId, 'propuesta:actualizada', cerrada);
        await reflejarEnMensaje(salaId, cerrada);
        await mensajeSistema(salaId, `${usuario.nombre} rechazó la propuesta de la IA pedida por ${propuesta.pedidoPorNombre}.`);
        return { ok: true, propuesta: cerrada };
    }

    // Todo lo que acepta propuestas en una sala va en fila: dos propuestas distintas aceptadas a la
    // vez no pueden leer el mismo diagrama y pisarse
    return conCandado(salaId, () => aceptarPropuesta(salaId, propuesta, usuario));
};

const aceptarPropuesta = async (salaId, propuesta, usuario) => {
    const propuestaId = propuesta.id;
    // 1) Reservar: si dos personas aceptan a la vez, solo una sigue
    if (!(await reservarPropuesta(propuestaId))) return { ok: false, mensaje: 'Otra persona ya decidió esta propuesta.' };
    const autorIA = { esIA: true, nombre: NOMBRE_IA, pedidoPor: propuesta.pedidoPorNombre, aprobadoPor: usuario.nombre };
    const cierre = (estado, motivo = null) => ({ estado, decididoPorId: usuario.id, decididoPorNombre: usuario.nombre, motivo });
    // 2) Calcular sobre el diagrama de este momento y guardar diagrama + cierre + historial en una
    //    sola transacción; recién con el COMMIT cambia lo que ven todos (aplicarAtomico.js)
    let r;
    try {
        r = await servidor.aplicarYGuardar(salaId, {
            autor: autorIA,
            calcular: (estado) => aplicarOperaciones(estado, propuesta.operaciones),
            alGuardar: (db) => finalizarPropuesta(propuestaId, cierre('aceptada'), db),
        });
    } catch (error) {
        r = { aplicada: false, error };
    }
    const n = propuesta.operaciones.length;
    if (r.aplicada) {
        servidor.emitir(salaId, 'propuesta:actualizada', r.resultado);
        await reflejarEnMensaje(salaId, r.resultado);
        await mensajeSistema(salaId, `${usuario.nombre} aceptó la propuesta de la IA (pedida por ${propuesta.pedidoPorNombre}): ${n} cambio${n === 1 ? '' : 's'} aplicado${n === 1 ? '' : 's'}.`);
        return { ok: true, propuesta: r.resultado };
    }
    if (r.problemas?.length) {
        // Alguien cambió lo que la propuesta toca: no se aplicó nada
        const motivo = r.problemas.join('; ');
        const cerrada = await finalizarPropuesta(propuestaId, cierre('desactualizada', motivo));
        if (cerrada) {
            servidor.emitir(salaId, 'propuesta:actualizada', cerrada);
            await reflejarEnMensaje(salaId, cerrada);
        }
        await mensajeSistema(salaId, `La propuesta de la IA ya no se puede aplicar: ${motivo}. No se cambió nada; pídansela de nuevo si todavía la quieren.`);
        return { ok: false, mensaje: `La propuesta quedó desactualizada: ${motivo}.` };
    }
    // 3) No se pudo guardar: la transacción se deshizo entera y la memoria no cambió. La propuesta
    //    vuelve a estar pendiente para aceptarla de nuevo (nunca queda "aceptada" sin su cambio)
    console.error(`Propuesta ${propuestaId}: no se pudo guardar, vuelve a pendiente:`, r.error?.message || r.error);
    await reabrirPropuesta(propuestaId).catch(() => {});
    const actual = await obtenerPropuesta(propuestaId).catch(() => null);
    if (actual) servidor.emitir(salaId, 'propuesta:actualizada', actual);
    return { ok: false, mensaje: 'No se pudo guardar el cambio. No se aplicó nada y la propuesta sigue pendiente: intenta aceptarla de nuevo.' };
};
