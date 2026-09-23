import { createUserSala, getUserSalaById, getUserSalas, deleteUserSala } from '../models/usersala.model.js';
import { getSalaById } from '../models/sala.model.js'
import { getUserByEmail } from '../models/auth.model.js';
import { catchedAsync, response } from '../middlewares/catchedAsync.js';

class UserSalaController {
    constructor() {}

    // Devuelve { ok, status, message, sala } comprobando que la sala existe
    // y que el solicitante es su dueño.
    esDuenoDeSala = async (salaId, requesterId) => {
        const salaRows = await getSalaById(salaId);
        if (!salaRows || salaRows.length === 0) {
            return { ok: false, status: 404, message: 'El tablero no existe o fue eliminado.' };
        }
        const sala = salaRows[0];
        const ownerId = sala.userId || sala.userid || sala.user_id;
        if (parseInt(ownerId, 10) !== parseInt(requesterId, 10)) {
            return { ok: false, status: 403, message: 'Solo el creador del tablero puede gestionar a sus participantes.', sala };
        }
        return { ok: true, sala };
    };

    register = catchedAsync(async (req, res) => {
        const { salas_id, userId, email } = req.body;

        // Solo el dueño de la sala puede invitar
        const permiso = await this.esDuenoDeSala(salas_id, req.user.id);
        if (!permiso.ok) {
            const msg = permiso.status === 403 ? 'Solo el dueño de la sala puede invitar usuarios' : permiso.message;
            return response(res, permiso.status, { error: true, message: msg });
        }

        // Resolver el usuario a invitar: por email (preferido) o por userId
        let invitedId = userId;
        if (email) {
            const invitedUser = await getUserByEmail(email);
            if (!invitedUser) {
                return response(res, 404, { error: true, message: 'No hay ninguna cuenta registrada con ese correo. Pide a la persona que se registre primero.' });
            }
            invitedId = invitedUser.id;
        }
        if (!invitedId) {
            return response(res, 400, { error: true, message: 'Escribe el correo de la persona que quieres invitar.' });
        }
        if (parseInt(invitedId, 10) === parseInt(req.user.id, 10)) {
            return response(res, 400, { error: true, message: 'No puedes invitarte a ti mismo: ya eres el creador del tablero.' });
        }

        try {
            const usersala = await createUserSala(invitedId, salas_id);
            response(res, 201, usersala);
        } catch (error) {
            if (error.message && error.message.includes('ya está asociado')) {
                return response(res, 409, { error: true, message: 'Esa persona ya tiene acceso a este tablero.' });
            }
            throw error;
        }
    });

    getUserSalaById = catchedAsync(async (req, res) => {
        const { id } = req.params;
        const usersala = await getUserSalaById(id);
        if (!usersala) {
            return response(res, 404, { error: true, message: 'Esa persona ya no participa en este tablero.' });
        }
        // Solo el dueño de la sala o el propio usuario de la fila pueden verla
        const filaUserId = usersala.userid ?? usersala.userId;
        const esPropio = parseInt(filaUserId, 10) === parseInt(req.user.id, 10);
        if (!esPropio) {
            const permiso = await this.esDuenoDeSala(usersala.salas_id, req.user.id);
            if (!permiso.ok) {
                return response(res, permiso.status, { error: true, message: permiso.message });
            }
        }
        response(res, 200, usersala);
    });

    getUserSalas = catchedAsync(async (req, res) => {
        const userId = req.user.id;
        const usersalas = await getUserSalas(userId);
        response(res, 200, usersalas);
    });

    delete = catchedAsync(async (req, res) => {
        const { id } = req.params;
        const fila = await getUserSalaById(id);
        if (!fila) {
            return response(res, 404, { error: true, message: 'Esa persona ya no participa en este tablero.' });
        }
        // Permitido si es el dueño de la sala (expulsar) o el propio usuario (salir del tablero)
        const filaUserId = fila.userid ?? fila.userId;
        const esPropio = parseInt(filaUserId, 10) === parseInt(req.user.id, 10);
        if (!esPropio) {
            const permiso = await this.esDuenoDeSala(fila.salas_id, req.user.id);
            if (!permiso.ok) {
                const msg = permiso.status === 403
                    ? 'Solo el dueño de la sala puede quitar a otros participantes'
                    : permiso.message;
                return response(res, permiso.status, { error: true, message: msg });
            }
        }
        const usersala = await deleteUserSala(id);
        response(res, 200, usersala);
    });
}

export default new UserSalaController();
