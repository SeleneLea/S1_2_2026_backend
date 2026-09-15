import pool from '../config/db.js';
import bcrypt from 'bcrypt';

export const createUser = async (name, email, password) => {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
        `SELECT * FROM create_user_if_not_exists($1, $2, $3)`,
        [name, email, passwordHash]
    );
    return result.rows[0];
};

export const getUserById = async (id) => {
    const result = await pool.query('SELECT * FROM "Users" WHERE id = $1', [id] );
    return result.rows[0];
};

export const getUserByEmail = async (email) => {
  const result = await pool.query('SELECT * FROM "Users" WHERE email = $1 and eliminar = false', [email]);
  return result.rows[0];
};

export const getUsersExcludingId = async (id) => {
  const result = await pool.query(
    'SELECT * FROM "Users" WHERE id != $1 AND eliminar = false',
    [id]
  );
  return result.rows;
};

export const verifyUserCredentials = async (email, password) => {
    const user = await getUserByEmail(email);
    if (user && await bcrypt.compare(password, user.password)) {
      return user;
    }
    return null;
};

export const updateUser = async (id, name, email, password) => {
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query( 'UPDATE "Users" SET name = $1, email = $2, password = $3 WHERE id = $4 and eliminar = false RETURNING id, name, email', [name, email, passwordHash, id]);
  return result.rows[0];
};

export const deleteUser = async (id) => {
  const result = await pool.query(
    `SELECT * FROM delete_User($1)`,
    [id]
  );
  return result.rows[0];
};
