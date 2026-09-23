import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

// En la nube la base suele llegar como una sola URL (DATABASE_URL); en local, con las variables DB_*
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL && !process.env.DB_PASSWORD) {
  console.error('FATAL: define DATABASE_URL o DB_PASSWORD (con el resto de DB_*) antes de arrancar.');
  process.exit(1);
}

// Las bases administradas exigen TLS cuando se conecta desde fuera de su red: DB_SSL=true
const ssl = /^(1|true|require)$/i.test(process.env.DB_SSL || '') ? { rejectUnauthorized: false } : null;

const pool = new Pool({
  ...(DATABASE_URL
    ? { connectionString: DATABASE_URL }
    : {
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || process.env.DB_DATABASE || 'diagrama_dev',
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT || '5432', 10)
      }),
  ...(ssl ? { ssl } : {})
});

// Un error en una conexión inactiva (p. ej. la base se reinició) no debe tumbar el servidor
pool.on('error', (err) => console.error('PostgreSQL: error en una conexión inactiva:', err.message));

export default pool;
