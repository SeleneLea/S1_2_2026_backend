import 'dotenv/config';
import app from './config/app.js';
import pool from './config/db.js';
import { inicializarBaseDatos } from './config/inicializarBaseDatos.js';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import http from 'http';
import errorHandler from './middlewares/catchedAsync.js';
import { updateSala, getSalaById } from './models/sala.model.js';
import { createUserSala, getUsersBySala } from './models/usersala.model.js';
import { FRONTEND_URLS, TOKEN_SECRET } from './config.js';

// Conecta y, si la base está vacía (primer despliegue), crea las tablas desde database.sql
const baseLista = inicializarBaseDatos()
    .then((creada) => console.log(creada ? 'DB connected: tablas creadas desde database.sql' : 'DB connected successfully'))
    .catch(err => console.error("Error connecting to DB", err.stack));

const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: FRONTEND_URLS,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        credentials: true
    }
});

// Socket.IO authentication middleware: validate JWT from cookie or auth payload
io.use((socket, next) => {
    try {
        const cookieHeader = socket.handshake.headers.cookie || '';
        let token = null;
        const match = cookieHeader.match(/(^|;\s*)token=([^;]+)/);
        if (match) token = decodeURIComponent(match[2]);
        // fallback to auth payload (for cross-origin or testing)
        if (!token && socket.handshake.auth && socket.handshake.auth.token) {
            token = socket.handshake.auth.token;
        }

        if (!token) {
            // Sin token no se permite la conexión: toda colaboración requiere sesión
            return next(new Error('Authentication required'));
        }

        jwt.verify(token, TOKEN_SECRET, (err, decoded) => {
            if (err) {
                console.warn('Socket auth failed:', err.message);
                return next(new Error('Authentication error'));
            }
            socket.user = decoded;
            return next();
        });
    } catch (err) {
        console.error('Socket auth middleware error', err);
        return next(new Error('Authentication error'));
    }
});

app.set('io', io);
const salasActivas = new Map();
// Debounced save timers per sala to avoid excessive DB writes during rapid updates
const pendingSaveTimers = new Map();
const SAVE_DEBOUNCE_MS = parseInt(process.env.SAVE_DEBOUNCE_MS || '3000', 10);

io.on('connection', (socket) => {
    // console.log('🟢 Nuevo cliente conectado:', socket.id);
    // Accept optional ack callback: socket.emit('unirseSala', payload, (ack) => { ... })
    socket.on('unirseSala', async ({ salaId, usuario } = {}, callback) => {
        try {
            const salaIdNormalizado = parseInt(salaId, 10);
            if (isNaN(salaIdNormalizado)) {
                console.error(`❌ salaId inválido recibido: ${salaId} (tipo: ${typeof salaId})`);
                socket.emit('errorSincronizacion', { message: 'ID de sala inválido' });
                return;
            }

            // Control de acceso: el socket debe pertenecer a un usuario autenticado
            const authUserId = socket.user && socket.user.id;
            if (!authUserId) {
                socket.emit('errorSincronizacion', { message: 'Debes iniciar sesión para unirte a la sala' });
                return;
            }

            // La sala debe existir; verificar membresía (dueño o invitado en Usersala)
            const salaRows = await getSalaById(salaIdNormalizado);
            if (!salaRows || salaRows.length === 0) {
                socket.emit('errorSincronizacion', { message: 'Sala no encontrada' });
                return;
            }
            const ownerId = salaRows[0].userId || salaRows[0].userid || salaRows[0].user_id;
            const esDueno = parseInt(ownerId, 10) === parseInt(authUserId, 10);
            if (!esDueno) {
                const miembros = await getUsersBySala(salaIdNormalizado);
                const esMiembro = miembros.some(m => parseInt(m.userid ?? m.userId, 10) === parseInt(authUserId, 10));
                if (!esMiembro) {
                    // Política adoptada: entrar con el link/QR estando autenticado
                    // equivale a aceptar la invitación → se registra en Usersala.
                    try {
                        await createUserSala(authUserId, salaIdNormalizado);
                    } catch (joinErr) {
                        // Duplicado por carrera: ignorar; cualquier otro error sí bloquea
                        if (!(joinErr.message && joinErr.message.includes('ya está asociado'))) {
                            console.error('unirseSala: no se pudo registrar la membresía', joinErr);
                            socket.emit('errorSincronizacion', { message: 'No se pudo verificar el acceso a la sala' });
                            return;
                        }
                    }
                }
            }

            socket.join(`sala_${salaIdNormalizado}`);
            socket.salaId = salaIdNormalizado;
            // Resolve usuario: prefer payload, then socket.user (from JWT), fill defaults
            const resolvedUsuario = Object.assign({ id: null, name: 'guest', email: null }, socket.user || {}, usuario || {});
            socket.usuario = resolvedUsuario;
            // Usar salaId normalizado en todas las operaciones
            if (!salasActivas.has(salaIdNormalizado)) {
                salasActivas.set(salaIdNormalizado, {
                    usuarios: new Map(),
                    ultimoEstado: null,
                    ultimaModificacion: null
                });
            }
            const sala = salasActivas.get(salaIdNormalizado);
            sala.usuarios.set(socket.id, { ...resolvedUsuario, socketId: socket.id });
            const clientesSocketIO = io.sockets.adapter.rooms.get(`sala_${salaIdNormalizado}`);
                    // console.log(`Room state for sala ${salaIdNormalizado}:`);
                    // console.log(`   users in memory: ${sala.usuarios.size}`);
                    // console.log(`   socket.io clients in room: ${clientesSocketIO ? clientesSocketIO.size : 0}`);

                    // sala.usuarios.forEach((user, socketId) => {
                    //     console.log(`      - ${user.name} (${user.isInvited ? 'invited' : 'owner'}) - socket: ${socketId}`);
                    // });
            
            socket.to(`sala_${salaIdNormalizado}`).emit('usuarioUnido', { 
                usuario: resolvedUsuario,
                timestamp: Date.now()
            });

            // If client provided an ack callback, confirm join
                try {
                if (typeof callback === 'function') {
                    callback({ ok: true, salaId: salaIdNormalizado, usuarios: Array.from(sala.usuarios.values()) });
                }
            } catch (err) {
                // console.warn('unirseSala: ack callback failed', err);
            }
            
            try {
                // console.log(`Socket: loading state for sala ID: ${salaIdNormalizado}`);
                const salaData = await getSalaById(salaIdNormalizado);
                if (salaData && salaData.length > 0 && salaData[0].xml) {
                    const estadoInicial = JSON.parse(salaData[0].xml);
                    socket.emit('estadoInicial', { state: estadoInicial });
                    
                    socket.emit('xmlActualizado', {
                        nuevoEstado: estadoInicial,
                        message: 'synchronizing with current board',
                        timestamp: new Date(),
                        source: 'initial_sync'
                    });
                    
                    sala.ultimoEstado = estadoInicial;
                } else {
                    socket.emit('estadoInicial', { state: null });
                }
            } catch (error) {
                console.error(`❌ Socket: Error cargando estado para sala ${salaIdNormalizado}:`, error);
                socket.emit('estadoInicial', { state: null });
            }
            const usuariosConectados = Array.from(sala.usuarios.values());
            // A toda la sala (incluido el que entra) para que todos reconstruyan la lista
            io.to(`sala_${salaIdNormalizado}`).emit('usuariosConectados', { usuarios: usuariosConectados });
            // usuariosConectados.forEach(u => {
            //     console.log(`      - ${u.name} (${u.isInvited ? 'INVITADO/USERSALA' : 'PROPIETARIO'})`);
            // });
        } catch (error) {
            console.error('Error al unirse a la sala:', error);
            socket.emit('errorSincronizacion', { message: 'Error al unirse a la sala' });
        }
    });
    
    socket.on('cambioInstantaneo', (data) => {
        try {
            // Prefer usuario from payload, fallback to socket.usuario (set on unirseSala) or socket.user (JWT)
            const { salaId, usuario: payloadUsuario, tipo, elemento, timestamp } = data || {};
            const usuario = payloadUsuario || socket.usuario || socket.user || null;
            if (!salaId || !tipo || !elemento) {
                console.warn('❌ Datos insuficientes en cambioInstantaneo:', { salaId, tipo, elemento: elemento?.id });
                socket.emit('errorSincronizacion', { message: 'Datos insuficientes para sincronizar cambio' });
                return;
            }
            // Accept usuario if it has at least a name, email or id
            if (!usuario || !(usuario.name || usuario.email || usuario.id)) {
                console.warn('❌ Usuario inválido en cambioInstantaneo - payloadUsuario:', payloadUsuario, ' socket.usuario:', socket.usuario, ' socket.user:', socket.user);
                socket.emit('errorSincronizacion', { message: 'Usuario inválido para sincronizar cambio' });
                return;
            }
            const salaIdNormalizado = parseInt(salaId, 10);
            if (!socket.salaId || parseInt(socket.salaId, 10) !== salaIdNormalizado) {
                socket.emit('errorSincronizacion', { message: 'No estás conectado a esta sala' });
                return;
            }
            socket.to(`sala_${salaIdNormalizado}`).emit('cambioRecibido', {
                salaId: salaIdNormalizado,
                usuario,
                tipo,
                elemento,
                timestamp: timestamp || Date.now()
            });
        } catch (error) {
            console.error('❌ Error en cambio instantáneo:', error);
            socket.emit('errorSincronizacion', { message: 'Error al sincronizar cambio' });
        }
    });
    
            socket.on('operacionElemento', (data) => {
        try {
            const { salaId, usuario: payloadUsuario2, operacion, elemento } = data || {};
            const usuario2 = payloadUsuario2 || socket.usuario || socket.user || null;
            if (!salaId || !operacion || !elemento) {
                console.warn('❌ Datos insuficientes en operacionElemento:', { salaId, operacion, elemento: elemento?.id });
                socket.emit('errorSincronizacion', { message: 'Datos insuficientes para operación elemento' });
                return;
            }
            if (!usuario2 || !(usuario2.name || usuario2.email || usuario2.id)) {
                console.warn('❌ Usuario inválido en operacionElemento - payloadUsuario2:', payloadUsuario2, ' socket.usuario:', socket.usuario, ' socket.user:', socket.user);
                socket.emit('errorSincronizacion', { message: 'Usuario inválido para operación elemento' });
                return;
            }
            const salaIdNormalizado = parseInt(salaId, 10);
            if (!socket.salaId || parseInt(socket.salaId, 10) !== salaIdNormalizado) {
                socket.emit('errorSincronizacion', { message: 'No estás conectado a esta sala' });
                return;
            }
            const sala = salasActivas.get(salaIdNormalizado);
            if (sala) {
                sala.ultimaModificacion = Date.now();
            }
            // Use usuario2 (resolved) when emitting
            socket.to(`sala_${salaIdNormalizado}`).emit('elementoOperado', {
                salaId: salaIdNormalizado,
                usuario: usuario2,
                operacion,
                elemento,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('❌ Error en operación elemento:', error);
            socket.emit('errorSincronizacion', { message: 'Error al sincronizar operación' });
        }
    });

    socket.on('actualizarDiagrama', (data) => {
        try {
            const { salaId, usuario, action } = data;
            const salaIdNormalizado = parseInt(salaId, 10);
            const socketSalaNormalizada = parseInt(socket.salaId, 10);
            if (!socket.salaId || socketSalaNormalizada !== salaIdNormalizado) {
                socket.emit('errorSincronizacion', { message: 'No estás conectado a esta sala' });
                return;
            }
            const sala = salasActivas.get(salaIdNormalizado);
            if (sala) {
                sala.ultimaModificacion = Date.now();
                if (action === 'fullState') {
                    sala.ultimoEstado = data.data.state;
                    // Schedule a debounced save to persist the new full state to DB
                    try {
                        // Clear any existing timer
                        const existing = pendingSaveTimers.get(salaIdNormalizado);
                        if (existing && existing.timeout) clearTimeout(existing.timeout);

                        const timeout = setTimeout(async () => {
                            try {
                                const xmlString = JSON.stringify(sala.ultimoEstado);
                                // console.log(`Debounced save: persisting sala ${salaIdNormalizado} (length ${xmlString.length})`);
                                await updateSala(salaIdNormalizado, undefined, xmlString, undefined, io);
                                pendingSaveTimers.delete(salaIdNormalizado);
                                // console.log(`Debounced save: sala ${salaIdNormalizado} persisted`);
                            } catch (saveErr) {
                                console.error(`Debounced save failed for sala ${salaIdNormalizado}:`, saveErr);
                            }
                        }, SAVE_DEBOUNCE_MS);

                        pendingSaveTimers.set(salaIdNormalizado, { timeout, ts: Date.now() });
                    } catch (schedErr) {
                        console.error('Error scheduling debounced save:', schedErr);
                    }
                }
            }
            const clientesEnSala = io.sockets.adapter.rooms.get(`sala_${salaIdNormalizado}`);
            const numClientesDestino = clientesEnSala ? clientesEnSala.size - 1 : 0;
            socket.to(`sala_${salaIdNormalizado}`).emit('diagramaActualizado', data);
        } catch (error) {
            console.error('❌ Error actualizando diagrama:', error);
            socket.emit('errorSincronizacion', { message: 'Error al sincronizar cambios' });
        }
    });

    socket.on('guardarEstado', async ({ salaId, estado }) => {
        try {
            // Normalizar y exigir que el socket esté unido a esa sala (igual que cambioInstantaneo)
            const salaIdNormalizado = parseInt(salaId, 10);
            if (isNaN(salaIdNormalizado) || parseInt(socket.salaId, 10) !== salaIdNormalizado) {
                socket.emit('errorSincronizacion', { message: 'No estás conectado a esta sala' });
                return;
            }
            const estadoJson = JSON.stringify(estado);
            await updateSala(salaIdNormalizado, undefined, estadoJson, undefined, io);
            const sala = salasActivas.get(salaIdNormalizado);
            if (sala) {
                sala.ultimoEstado = estado;
            }
            socket.emit('estadoGuardado', { success: true });
        } catch (error) {
            console.error(`❌ Socket: Error guardando estado para sala ${salaId}:`, error);
            socket.emit('errorSincronizacion', { message: 'Error al guardar en la base de datos' });
        }
    });

    socket.on('solicitarEstado', async ({ salaId }) => {
        try {
            const salaIdNormalizado = parseInt(salaId, 10);
            if (isNaN(salaIdNormalizado) || parseInt(socket.salaId, 10) !== salaIdNormalizado) {
                socket.emit('errorSincronizacion', { message: 'No estás conectado a esta sala' });
                return;
            }
            const sala = salasActivas.get(salaIdNormalizado);
            if (sala && sala.ultimoEstado) {
                socket.emit('estadoInicial', { state: sala.ultimoEstado });
                return;
            }
            const salaData = await getSalaById(salaIdNormalizado);
            if (salaData && salaData.length > 0 && salaData[0].xml) {
                const estadoInicial = JSON.parse(salaData[0].xml);
                socket.emit('estadoInicial', { state: estadoInicial });
                if (sala) {
                    sala.ultimoEstado = estadoInicial;
                }
            } else {
                socket.emit('estadoInicial', { state: null });
            }
        } catch (error) {
            console.error('Error cargando estado inicial:', error);
            socket.emit('errorSincronizacion', { message: 'Error al cargar estado inicial' });
        }
    });

    socket.on('disconnect', async () => {
        try {
            // console.log('Socket client disconnected:', socket.id);
            if (socket.salaId && socket.usuario) {
                const sala = salasActivas.get(socket.salaId);
                if (sala) {
                    sala.usuarios.delete(socket.id);
                    socket.to(`sala_${socket.salaId}`).emit('usuarioSalio', {
                        usuarioId: socket.usuario.id
                    });
                    // Reemitir la lista completa para que los clientes la reconstruyan
                    socket.to(`sala_${socket.salaId}`).emit('usuariosConectados', {
                        usuarios: Array.from(sala.usuarios.values())
                    });
                    if (sala.usuarios.size === 0) {
                        // Antes de descartar la sala en memoria, atender un guardado
                        // pendiente: si el debounce no llego a dispararse, persistimos
                        // ya mismo para no perder los ultimos cambios (y evitamos que
                        // el timer huerfano escriba encima de estado mas nuevo despues).
                        const pend = pendingSaveTimers.get(socket.salaId);
                        if (pend && pend.timeout) {
                            clearTimeout(pend.timeout);
                            if (sala.ultimoEstado) {
                                try {
                                    await updateSala(socket.salaId, undefined, JSON.stringify(sala.ultimoEstado), undefined, io);
                                } catch (saveErr) {
                                    console.error(`Error persistiendo estado final de sala ${socket.salaId}:`, saveErr);
                                }
                            }
                        }
                        pendingSaveTimers.delete(socket.salaId);
                        // console.log(`Cleaning empty room ${socket.salaId}`);
                        salasActivas.delete(socket.salaId);
                    }
                }
            }
        } catch (error) {
            console.error('Error en desconexión:', error);
        }
    });
});

app.use((req, res, next) => {
    res.status(404).json({ error: 'Not Found' });
});
app.use(errorHandler);

const PORT = process.env.PORT || 8083;
// Se escucha cuando la base respondió (o falló: /apis/health/db lo informa)
baseLista.finally(() => {
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});

// Al redesplegar o apagar, la plataforma envía SIGTERM: los tableros con guardado
// pendiente (debounce) se escriben antes de salir para no perder los últimos cambios.
let cerrando = false;
const cerrar = async (senal) => {
    if (cerrando) return;
    cerrando = true;
    console.log(`${senal}: guardando tableros pendientes y cerrando...`);
    setTimeout(() => process.exit(1), 10000).unref();
    await Promise.allSettled([...pendingSaveTimers.entries()].map(async ([salaId, pend]) => {
        clearTimeout(pend.timeout);
        const sala = salasActivas.get(salaId);
        if (sala && sala.ultimoEstado) {
            await updateSala(salaId, undefined, JSON.stringify(sala.ultimoEstado), undefined, io);
        }
    }));
    pendingSaveTimers.clear();
    io.close();
    await pool.end().catch(() => {});
    process.exit(0);
};
process.on('SIGTERM', () => cerrar('SIGTERM'));
process.on('SIGINT', () => cerrar('SIGINT'));
