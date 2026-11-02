/**
 * Eventos de tiempo real de la colaboración con la IA: chat de grupo, propuestas e historial.
 *
 * Cliente → servidor:
 *   chat:historial    { salaId, despuesDe?, actualizadosDesde? }  ack { mensajes, hayAnteriores, propuestas, ia, marca }
 *   chat:anteriores   { salaId, canal, antesDe }        ack { mensajes, hayMas }   canal: equipo | ia
 *   chat:enviar       { salaId, texto, paraIA }         ack { ok, mensaje }
 *   chat:importar     { salaId, mensajes: [...] }       ack { ok, aceptados: [idLocal] }   lo escrito sin conexión
 *   codigo:proponer   { salaId, cambios, origen }       ack { ok, propuestaId?, cantidad?, sinCambios? }   código -> diagrama
 * Cada mensaje trae su canal: 'equipo' (entre personas) o 'ia' (pedidos a la IA y sus respuestas).
 *   propuesta:decidir { salaId, propuestaId, decision } ack { ok, mensaje? }   decision: aceptar | rechazar
 *   historial:listar  { salaId, autor? }                ack { cambios }
 * Servidor → sala:
 *   chat:nuevo, chat:actualizado, propuesta:nueva, propuesta:actualizada, ia:estado, historial:nuevo
 * Servidor → quien entra:
 *   chat:bienvenida   { texto, desde }  lo que pasó desde su última visita
 */
import { decidirPropuesta, estadoIA, pedirALaIA, proponerDesdeCodigo } from './iaSala.js';
import { avisarIntegrantes } from './notificacionesPush.js';
import {
    CANALES, guardarMensaje, importarMensaje, leerUltimaVisita, listarCambios, listarMensajes, listarPropuestas, marcarVisita, mensajesDesde, marcaDeTiempo,
} from './repositorio.js';

export const LIMITE_TEXTO = 4000;
const MAX_IMPORTAR = 200;
const ID_LOCAL = /^[A-Za-z0-9:_-]{1,80}$/;
const textoCorto = (v, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/**
 * Un mensaje escrito sin conexión, validado. El autor sale de la sesión (no del navegador). Lo que
 * "dijo" la IA local queda como de la IA local DE esa persona: la IA compartida no lo dijo.
 */
/** Observaciones de una revisión hecha sin conexión: solo los campos conocidos, acotados. */
const observacionesValidas = (lista) => lista.slice(0, 40).map((o) => ({
    clase: textoCorto(o?.clase, 120) || '',
    nodoId: textoCorto(o?.nodoId, 120) || null,
    gravedad: ['error', 'aviso', 'sugerencia'].includes(o?.gravedad) ? o.gravedad : 'aviso',
    texto: String(o?.texto || '').trim().slice(0, 400),
})).filter((o) => o.texto);

export const filaSinConexion = (m, autor) => {
    if (!m || typeof m !== 'object' || !ID_LOCAL.test(String(m.idLocal || ''))) return null;
    const texto = String(m.texto || '').trim().slice(0, LIMITE_TEXTO);
    if (!texto || !['usuario', 'ia'].includes(m.tipo)) return null;
    const escrito = Date.parse(m.escritoEn);
    // Nunca en el futuro (un reloj adelantado no debe ordenar mal el chat)
    const escritoEn = new Date(Number.isNaN(escrito) ? Date.now() : Math.min(escrito, Date.now())).toISOString();
    const d = m.datos && typeof m.datos === 'object' ? m.datos : {};
    const base = { sinConexion: true, escritoEn };
    if (m.tipo === 'ia') {
        return {
            idLocal: m.idLocal, tipo: 'ia', texto, autorId: null, autorNombre: 'IA local',
            datos: {
                ...base, proveedor: 'IA local', pedidoPor: autor.nombre, pedidoPorId: autor.id ?? null,
                ...(textoCorto(d.motor, 40) ? { motor: textoCorto(d.motor, 40) } : {}),
                ...(textoCorto(d.modeloUsado, 80) ? { modeloUsado: textoCorto(d.modeloUsado, 80) } : {}),
                ...(Number.isInteger(d.cambios) && d.cambios >= 0 ? { cambios: Math.min(d.cambios, 10000) } : {}),
                // Revisión hecha sin conexión: sus observaciones marcan las clases también para los demás
                ...(d.tipoRespuesta === 'revision' ? { tipoRespuesta: 'revision' } : {}),
                ...(Array.isArray(d.observaciones) && d.observaciones.length ? { observaciones: observacionesValidas(d.observaciones) } : {}),
            },
        };
    }
    const paraIA = m.canal === 'ia' || d.paraIA === true;
    return {
        idLocal: m.idLocal, tipo: 'usuario', texto, autorId: autor.id ?? null, autorNombre: autor.nombre,
        datos: {
            ...base,
            ...(paraIA ? { paraIA: true } : {}),
            ...(d.deAudio === true ? { deAudio: true } : {}),
            ...(textoCorto(d.imagen?.nombre) ? { imagen: { nombre: textoCorto(d.imagen.nombre) } } : {}),
        },
    };
};

/** ¿El texto le habla a la IA? (@IA al comienzo o en cualquier parte) */
export const mencionaALaIA = (texto) => /(^|\s)@ia\b/i.test(texto);

/**
 * Publica el mensaje de un integrante en la sala y, si le habla a la IA, lo encola.
 * Lo usan el socket y la API REST (la app móvil).
 */
/**
 * @param {{ajusta?: number, imagen?: {buffer: Buffer, tipo: string, nombre?: string}, deAudio?: boolean}} extras
 *        ajusta: id de la propuesta que se pide ajustar ("Pedir ajuste"); imagen: foto o captura para
 *        la IA (no se guarda, solo viaja con el pedido); deAudio: el texto salió de un audio.
 */
export const publicarMensaje = async (io, salaId, autor, texto, paraIA = false, extras = {}) => {
    const imagen = extras.imagen || null;
    let limpio = String(texto || '').trim().slice(0, LIMITE_TEXTO);
    if (!limpio && imagen) limpio = 'Pásale esta imagen al diagrama.';
    if (!limpio) throw new Error('El mensaje está vacío.');
    const ajusta = Number(extras.ajusta) || null;
    // Una imagen o un ajuste siempre son para la IA
    const aLaIA = !!paraIA || !!imagen || !!ajusta || mencionaALaIA(limpio);
    const datos = {
        ...(aLaIA ? { paraIA: true } : {}),
        ...(ajusta ? { ajusta } : {}),
        ...(imagen ? { imagen: { nombre: String(imagen.nombre || 'imagen').slice(0, 120), tipo: imagen.tipo, tamano: imagen.buffer.length } } : {}),
        ...(extras.deAudio ? { deAudio: true } : {}),
    };
    const mensaje = await guardarMensaje({
        salaId, autorId: autor.id, autorNombre: autor.nombre, tipo: 'usuario', texto: limpio, datos: Object.keys(datos).length ? datos : null,
    });
    io.to(`sala_${salaId}`).emit('chat:nuevo', mensaje);
    avisarIntegrantes(salaId, autor.nombre, limpio, { excepto: autor.id });
    if (aLaIA) pedirALaIA(salaId, mensaje, autor, { imagen });
    return mensaje;
};

const fecha = (d) => new Date(d).toLocaleString('es-BO', {
    timeZone: process.env.ZONA_HORARIA || 'America/La_Paz', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

/**
 * "Desde tu última visita...": lo que hicieron los demás mientras no estabas (RF-08).
 * No usa la IA (es inmediato); para un resumen conversado se le pregunta a @IA.
 */
export const resumenDesdeVisita = async (salaId, usuario) => {
    const desde = await leerUltimaVisita(usuario.id, salaId);
    if (!desde) return null;
    const cambios = (await listarCambios(salaId, { desde, limite: 300 }))
        .filter((c) => c.esIA || c.autorId !== usuario.id);
    const mensajes = (await listarMensajes(salaId, { limite: 200 }))
        .filter((m) => new Date(m.creadoEn) > new Date(desde) && m.autorId !== usuario.id);
    if (!cambios.length && !mensajes.length) return null;
    const porAutor = new Map();
    for (const c of cambios) {
        const quien = c.esIA ? `la IA (pedido por ${c.pedidoPor || '?'})` : c.autorNombre || 'alguien';
        if (!porAutor.has(quien)) porAutor.set(quien, []);
        porAutor.get(quien).push(c.resumen);
    }
    const lineas = [`Desde tu última visita (${fecha(desde)}):`];
    for (const [quien, lista] of porAutor) {
        const muestra = lista.slice(-4).join('; ');
        lineas.push(`- ${quien}: ${lista.length} cambio${lista.length === 1 ? '' : 's'} (${muestra}${lista.length > 4 ? '; …' : ''})`);
    }
    if (mensajes.length) lineas.push(`- ${mensajes.length} mensaje${mensajes.length === 1 ? '' : 's'} nuevo${mensajes.length === 1 ? '' : 's'} en el chat.`);
    lineas.push('Pregúntale a @IA "¿qué hicieron?" si quieres el detalle.');
    return { texto: lineas.join('\n'), desde };
};

/**
 * Registra los eventos de colaboración en un socket ya autenticado.
 * @param {() => {id: number, nombre: string}|null} autorDe  quién es el socket (sale del token)
 */
export const registrarEventosColaboracion = (io, socket, autorDe) => {
    const enSala = (salaId) => {
        const id = parseInt(salaId, 10);
        return !isNaN(id) && parseInt(socket.salaId, 10) === id ? id : null;
    };
    const responder = (ack, datos) => { if (typeof ack === 'function') ack(datos); };

    // despuesDe (id): al reconectar se piden solo los mensajes posteriores al último que se tiene,
    // así no queda un hueco entre lo viejo y lo nuevo. Si son demasiados, completo=false y el
    // cliente empieza de nuevo con los últimos (y "Cargar anteriores" desde ahí).
    const TOPE_REANUDAR = 300;
    // marca: hora del servidor tomada ANTES de leer; el cliente la devuelve al reconectar
    // (actualizadosDesde) y recibe también los mensajes conocidos que cambiaron mientras tanto
    // (la IA publica su mensaje y después le agrega el id de la propuesta).
    socket.on('chat:historial', async ({ salaId, despuesDe, actualizadosDesde } = {}, ack) => {
        const id = enSala(salaId);
        if (!id) return responder(ack, { ok: false, mensaje: 'Abre el tablero antes de cargar el chat.' });
        try {
            const marca = await marcaDeTiempo();
            const desde = parseInt(despuesDe, 10);
            if (!isNaN(desde)) {
                const cambiadosDesde = actualizadosDesde && !isNaN(Date.parse(actualizadosDesde)) ? actualizadosDesde : null;
                const [nuevos, propuestas] = await Promise.all([
                    mensajesDesde(id, desde, TOPE_REANUDAR + 1, cambiadosDesde),
                    listarPropuestas(id, { limite: 20 }),
                ]);
                const completo = nuevos.length <= TOPE_REANUDAR;
                return responder(ack, { ok: true, reanudacion: true, completo, marca, mensajes: completo ? nuevos : [], propuestas, ia: estadoIA(id) });
            }
            // Los últimos de CADA chat: uno muy activo no deja vacío al otro
            const POR_CANAL = 80;
            const [equipo, deIA, propuestas] = await Promise.all([
                listarMensajes(id, { limite: POR_CANAL, canal: 'equipo' }),
                listarMensajes(id, { limite: POR_CANAL, canal: 'ia' }),
                listarPropuestas(id, { limite: 20 }),
            ]);
            const mensajes = [...equipo, ...deIA].sort((a, b) => a.id - b.id);
            const hayAnteriores = { equipo: equipo.length >= POR_CANAL, ia: deIA.length >= POR_CANAL };
            responder(ack, { ok: true, marca, mensajes, hayAnteriores, propuestas, ia: estadoIA(id) });
        } catch (error) {
            console.error('chat:historial', error.message);
            responder(ack, { ok: false, mensaje: 'No se pudo cargar el chat de la sala.' });
        }
    });

    socket.on('chat:enviar', async ({ salaId, texto, paraIA, ajusta } = {}, ack) => {
        const id = enSala(salaId);
        const autor = autorDe();
        if (!id || !autor) return responder(ack, { ok: false, mensaje: 'Se perdió la conexión con el tablero. Recarga la página.' });
        try {
            const mensaje = await publicarMensaje(io, id, autor, texto, paraIA, { ajusta });
            responder(ack, { ok: true, mensaje });
        } catch (error) {
            responder(ack, { ok: false, mensaje: error.message === 'El mensaje está vacío.' ? error.message : 'No se pudo enviar el mensaje.' });
        }
    });

    /**
     * Lo que se escribió SIN CONEXIÓN (mensajes al equipo, pedidos a la IA local y lo que respondió):
     * al volver se comparte con la sala para que todos sepan qué se hizo. No se le pide nada a la IA
     * compartida (ya lo resolvió la IA local) y cada mensaje se guarda una sola vez (id local).
     */
    socket.on('chat:importar', async ({ salaId, mensajes } = {}, ack) => {
        const id = enSala(salaId);
        const autor = autorDe();
        if (!id || !autor) return responder(ack, { ok: false, mensaje: 'Se perdió la conexión con el tablero.' });
        if (!Array.isArray(mensajes) || mensajes.length > MAX_IMPORTAR) {
            return responder(ack, { ok: false, mensaje: `Se pueden subir hasta ${MAX_IMPORTAR} mensajes por vez.` });
        }
        const aceptados = [];
        const guardados = [];
        try {
            for (const crudo of mensajes) {
                const fila = filaSinConexion(crudo, autor);
                if (!fila) continue;
                const { mensaje, nuevo } = await importarMensaje({ salaId: id, ...fila });
                if (!mensaje) continue;
                aceptados.push(fila.idLocal);
                if (nuevo) {
                    guardados.push(mensaje);
                    io.to(`sala_${id}`).emit('chat:nuevo', mensaje);
                }
            }
            if (guardados.length) {
                avisarIntegrantes(id, autor.nombre, `compartió ${guardados.length} mensaje${guardados.length === 1 ? '' : 's'} escrito${guardados.length === 1 ? '' : 's'} sin conexión`, { excepto: autor.id });
            }
            responder(ack, { ok: true, aceptados, guardados: guardados.length });
        } catch (error) {
            console.error('chat:importar', error.message);
            // Lo aceptado hasta el error ya quedó guardado: el resto se reintenta
            responder(ack, { ok: false, aceptados, mensaje: 'No se pudo compartir lo escrito sin conexión.' });
        }
    });

    // Código -> diagrama: las diferencias con un proyecto Spring Boot importado quedan como propuesta
    socket.on('codigo:proponer', async ({ salaId, cambios, origen } = {}, ack) => {
        const id = enSala(salaId);
        const autor = autorDe();
        if (!id || !autor) return responder(ack, { ok: false, mensaje: 'Se perdió la conexión con el tablero. Recarga la página.' });
        try {
            responder(ack, await proponerDesdeCodigo(id, cambios || {}, autor, origen || {}));
        } catch (error) {
            console.error('codigo:proponer', error.message);
            responder(ack, { ok: false, mensaje: 'No se pudo armar la propuesta con el código.' });
        }
    });

    // Mensajes más viejos de uno de los dos chats (paginación hacia atrás); sin canal, de los dos
    socket.on('chat:anteriores', async ({ salaId, antesDe, canal } = {}, ack) => {
        const id = enSala(salaId);
        if (!id) return responder(ack, { ok: false, mensajes: [] });
        try {
            const mensajes = await listarMensajes(id, {
                limite: 50, antesDe: parseInt(antesDe, 10) || null, canal: CANALES.includes(canal) ? canal : null,
            });
            responder(ack, { ok: true, mensajes, hayMas: mensajes.length === 50 });
        } catch (error) {
            responder(ack, { ok: false, mensajes: [] });
        }
    });

    socket.on('propuesta:decidir', async ({ salaId, propuestaId, decision } = {}, ack) => {
        const id = enSala(salaId);
        const autor = autorDe();
        if (!id || !autor) return responder(ack, { ok: false, mensaje: 'Se perdió la conexión con el tablero. Recarga la página.' });
        if (!['aceptar', 'rechazar'].includes(decision)) return responder(ack, { ok: false, mensaje: 'Decisión no válida.' });
        try {
            responder(ack, await decidirPropuesta(id, parseInt(propuestaId, 10), decision, autor));
        } catch (error) {
            console.error('propuesta:decidir', error);
            responder(ack, { ok: false, mensaje: 'No se pudo aplicar la decisión. Intenta de nuevo.' });
        }
    });

    socket.on('historial:listar', async ({ salaId, autor, despuesDe } = {}, ack) => {
        const id = enSala(salaId);
        if (!id) return responder(ack, { ok: false, cambios: [] });
        try {
            const desde = parseInt(despuesDe, 10);
            if (!isNaN(desde)) {
                const nuevos = await listarCambios(id, { limite: 500, despuesDe: desde });
                return responder(ack, { ok: true, reanudacion: true, completo: nuevos.length < 500, cambios: nuevos });
            }
            responder(ack, { ok: true, cambios: await listarCambios(id, { limite: 200, autor: autor || null }) });
        } catch (error) {
            responder(ack, { ok: false, cambios: [] });
        }
    });
};

/** Al entrar: avisa lo que pasó desde su última visita y la marca como visita nueva. */
export const darBienvenida = async (socket, salaId, usuario) => {
    if (!usuario?.id) return;
    try {
        const resumen = await resumenDesdeVisita(salaId, usuario);
        if (resumen) socket.emit('chat:bienvenida', resumen);
        await marcarVisita(usuario.id, salaId);
    } catch (error) {
        console.warn('Bienvenida de la sala:', error.message);
    }
};

export const registrarSalida = async (usuario, salaId) => {
    if (!usuario?.id || !salaId) return;
    await marcarVisita(usuario.id, salaId).catch(() => {});
};
