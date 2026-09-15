import { getSalaById } from '../models/sala.model.js';
import { getUsersBySala } from '../models/usersala.model.js';

/**
 * Comprueba si un usuario puede acceder a una sala: es su dueño o figura
 * como participante en Usersala. Misma regla que aplica el socket en unirseSala.
 *
 * @returns {Promise<{ok: boolean, status?: number, message?: string, sala?: object}>}
 */
export const puedeAccederASala = async (userId, salaId) => {
  if (!userId) {
    return { ok: false, status: 401, message: 'No autenticado' };
  }
  const salaRows = await getSalaById(salaId);
  if (!salaRows || salaRows.length === 0) {
    return { ok: false, status: 404, message: 'Sala no encontrada' };
  }
  const sala = salaRows[0];
  const ownerId = sala.userId || sala.userid || sala.user_id;
  if (parseInt(ownerId, 10) === parseInt(userId, 10)) {
    return { ok: true, sala };
  }
  const miembros = await getUsersBySala(salaId);
  const esMiembro = miembros.some(m => parseInt(m.userid ?? m.userId, 10) === parseInt(userId, 10));
  if (!esMiembro) {
    return { ok: false, status: 403, message: 'No tienes acceso a este tablero', sala };
  }
  return { ok: true, sala };
};

export default puedeAccederASala;
