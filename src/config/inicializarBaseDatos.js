/**
 * Prepara la base al arrancar: si está vacía (primer despliegue) ejecuta database.sql para crear
 * tablas y funciones, así no hay que correr el script a mano. Si las tablas ya existen no toca nada.
 */
import { readFile } from 'node:fs/promises';
import pool from './db.js';

const RUTA_SQL = new URL('./database.sql', import.meta.url);

/** Devuelve true si creó el esquema, false si ya existía. */
export const inicializarBaseDatos = async () => {
  const { rows } = await pool.query(`SELECT to_regclass('public."Users"') IS NOT NULL AS existe`);
  if (rows[0].existe) return false;

  const sql = await readFile(RUTA_SQL, 'utf8');
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(sql);
    await cliente.query('COMMIT');
    return true;
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
};
