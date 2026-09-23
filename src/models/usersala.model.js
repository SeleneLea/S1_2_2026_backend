import pool from '../config/db.js';

export const createUserSala = async (userId, salas_id) => {
    // Comprobar existencia específica para la sala y el usuario
    const existingEntry = await pool.query(
        `SELECT * FROM "Usersala" WHERE userId = $1 AND salas_id = $2`,
        [userId, salas_id]
    );
    if (existingEntry.rows.length > 0) {
        throw new Error('El usuario ya está asociado a esta sala.');
    }
    const result = await pool.query(
        `INSERT INTO "Usersala" (userId, salas_id) VALUES ($1, $2) RETURNING *`,
        [userId, salas_id]
    );
    return result.rows[0];
};

export const getUserSalaById = async (id) => {
    const result = await pool.query(
        'SELECT * FROM "Usersala" WHERE id = $1',
        [id]
    );
    return result.rows[0];
};

export const getUserSalas = async (userId) => {
    const result = await pool.query(
        `SELECT s.*
         FROM "Usersala" us
         JOIN "Salas" s ON us.salas_id = s.id
         WHERE us.userId = $1 AND s.eliminar = false`,
        [userId]
    );
    return result.rows;
};

export const getUsersBySala = async (salaId) => {
    const result = await pool.query(
        `SELECT u.id as userId, u.name, u.email, us.id as userSalaId
         FROM "Usersala" us
         JOIN "Users" u ON us.userId = u.id
         WHERE us.salas_id = $1`,
        [salaId]
    );
    // console.log(`DB: found ${result.rows.length} users in sala ${salaId}`);
    return result.rows;
};

export const deleteUserSala = async (id) => {
    const result = await pool.query(
        'DELETE FROM "Usersala" WHERE id = $1 RETURNING *',
        [id]
    );
    return result.rows[0];
};
