import { Router } from 'express';
import multer from 'multer';
import { authRequired } from '../middlewares/validateToken.js';
import { catchedAsync, response } from '../middlewares/catchedAsync.js';
import { leerModeloEAP, ErrorEAP } from '../importers/eapReader.js';

const router = Router();

const LIMITE_MB = 50;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LIMITE_MB * 1024 * 1024 },
});

// Los errores de multer (archivo demasiado grande, campo inesperado) son del cliente: 400
const recibirArchivo = (req, res, next) => {
    upload.single('archivo')(req, res, (err) => {
        if (err) {
            err.statusCode = 400;
            if (err.code === 'LIMIT_FILE_SIZE') err.message = `El archivo supera los ${LIMITE_MB} MB.`;
        }
        next(err);
    });
};

// Proyecto de Enterprise Architect (.EAP) -> clases, conectores y diagramas
router.post('/eap', authRequired, recibirArchivo, catchedAsync(async (req, res) => {
    if (!req.file) throw new ErrorEAP('No se recibió ningún archivo.');
    response(res, 200, leerModeloEAP(req.file.buffer));
}));

export default router;
