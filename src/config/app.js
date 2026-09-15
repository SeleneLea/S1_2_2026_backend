import express from 'express';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from '../routes/auth.routes.js';
import salaRoutes from '../routes/sala.routes.js';
import usersalaRoutes from '../routes/usersala.routes.js';
import crearPaginaRoutes from '../routes/crearPagina.routes.js';
import aiRoutes from '../routes/ai.routes.js';
import healthRoutes from '../routes/health.routes.js';
import { FRONTEND_URLS } from '../config.js';
import importarRoutes from '../routes/importar.routes.js';
const app = express();

// Detrás del proxy HTTPS de la plataforma: req.secure y req.protocol usan X-Forwarded-Proto
app.set('trust proxy', 1);

app.use(morgan('dev'));
app.use(express.json());
app.use(cookieParser());

// Cuando el backend sirve el frontend, el navegador igual manda Origin en los POST:
// ese origen (el mismo host) se acepta sin tener que declararlo en FRONTEND_URL.
const esMismoOrigen = (req, origin) => {
    try {
        const host = new URL(origin).host;
        return host === req.get('host') || host === req.get('x-forwarded-host');
    } catch {
        return false;
    }
};

app.use(cors((req, callback) => {
    const origin = req.get('origin');
    if (origin && !FRONTEND_URLS.includes(origin) && !esMismoOrigen(req, origin)) {
        return callback(new Error('Not allowed by CORS'));
    }
    callback(null, {
        origin: true,
        credentials: true,
        // Sin esto, el navegador OCULTA Content-Disposition en peticiones cross-origin
        // y las descargas (ZIP, SQL) pierden el nombre de archivo que envia el servidor.
        exposedHeaders: ['Content-Disposition']
    });
}));

app.use("/apis", authRoutes);

app.use("/apis/sala", salaRoutes);

app.use("/apis/usersala", usersalaRoutes);

app.use('/apis/crearPagina', crearPaginaRoutes);

app.use('/apis/ai', aiRoutes);

// Health checks (DB connectivity, etc.)
app.use('/apis/health', healthRoutes);

// Importación de proyectos de Enterprise Architect (.EAP)
app.use('/apis/importar', importarRoutes);

// Frontend compilado (npm run build): la misma URL sirve la app, la API y los sockets, así la
// cookie de sesión es del mismo sitio. En desarrollo no hay build y el frontend lo sirve Vite.
const DIST_FRONTEND = process.env.FRONTEND_DIST || fileURLToPath(new URL('../../../frontend/dist', import.meta.url));

if (fs.existsSync(path.join(DIST_FRONTEND, 'index.html'))) {
    // Tipos que algunos servidores no conocen y el navegador exige (módulos .mjs de la IA local)
    const TIPOS = {
        '.mjs': 'text/javascript; charset=utf-8',
        '.wasm': 'application/wasm',
        '.webmanifest': 'application/manifest+json'
    };
    app.use(express.static(DIST_FRONTEND, {
        index: false,
        setHeaders: (res, ruta) => {
            const tipo = TIPOS[path.extname(ruta)];
            if (tipo) res.setHeader('Content-Type', tipo);
            // assets/ lleva hash en el nombre; el resto (index.html, sw.js, ort/) se revalida
            res.setHeader('Cache-Control', ruta.includes(`${path.sep}assets${path.sep}`)
                ? 'public, max-age=31536000, immutable'
                : 'no-cache');
        }
    }));
    // Rutas de la aplicación (/board/5, /login...): las resuelve React Router
    app.get(/^\/(?!apis(?:\/|$)|socket\.io(?:\/|$)).*/, (req, res, next) => {
        if (!req.accepts('html')) return next();
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(DIST_FRONTEND, 'index.html'));
    });
    console.log(`Frontend compilado servido desde ${DIST_FRONTEND}`);
}

export default app;
