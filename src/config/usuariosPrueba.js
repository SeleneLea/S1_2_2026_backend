/**
 * Cuentas de prueba: al arrancar se crean (o se les actualiza la contraseña) dos usuarios fijos,
 * para probar la app y la edición conjunta sin registrarse. La clave es CLAVE_USUARIOS_PRUEBA
 * (12345678 si no está definida: es un servidor de pruebas). Para no crearlas, definirla vacía.
 */
import bcrypt from 'bcrypt';
import pool from './db.js';

export const CLAVE_POR_DEFECTO = '12345678';

// anterior: correo de la primera versión de la cuenta; se da de baja para que no aparezca repetida
export const USUARIOS_PRUEBA = [
  { name: 'Usuario Prueba 1', email: 'prueba1@gmail.com', anterior: 'prueba1@example.com' },
  { name: 'Usuario Prueba 2', email: 'prueba2@gmail.com', anterior: 'prueba2@example.com' }
];

/** Devuelve las cuentas de prueba listas, con su id (vacío si la clave está vacía). */
export const asegurarUsuariosPrueba = async () => {
  const clave = (process.env.CLAVE_USUARIOS_PRUEBA ?? CLAVE_POR_DEFECTO).trim();
  if (!clave) return [];

  const hash = await bcrypt.hash(clave, 10);
  const cuentas = [];
  for (const { name, email, anterior } of USUARIOS_PRUEBA) {
    const actualizado = await pool.query(
      `UPDATE "Users" SET name = $1, password = $3, eliminar = false, updatedAt = CURRENT_TIMESTAMP
       WHERE email = $2 RETURNING id`,
      [name, email, hash]
    );
    const fila = actualizado.rowCount > 0
      ? actualizado.rows[0]
      : (await pool.query('INSERT INTO "Users" (name, email, password) VALUES ($1, $2, $3) RETURNING id', [name, email, hash])).rows[0];
    await pool.query(
      'UPDATE "Users" SET eliminar = true, updatedAt = CURRENT_TIMESTAMP WHERE email = $1 AND eliminar = false',
      [anterior]
    );
    cuentas.push({ email, id: fila.id });
  }
  return cuentas;
};
