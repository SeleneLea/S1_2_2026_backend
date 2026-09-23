import dotenv from 'dotenv';

dotenv.config();

if (!process.env.TOKEN_SECRET) {
    console.error('FATAL: TOKEN_SECRET no está definida. Configura backend/.env antes de arrancar.');
    process.exit(1);
}
export const TOKEN_SECRET = process.env.TOKEN_SECRET;

// Aceptar por defecto los puertos de desarrollo más comunes (Vite 5173, 5000, 3000)
// Añadimos 5173 para soportar Vite dev server por defecto
const frontendUrlsString = process.env.FRONTEND_URL || 'http://localhost:5173,http://localhost:5000,http://localhost:3000';
export const FRONTEND_URLS = frontendUrlsString.split(',').map(url => url.trim());
export const FRONTEND_URL = FRONTEND_URLS[0];
