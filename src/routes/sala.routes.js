import { Router } from "express";
import salaController from '../controllers/sala.controllers.js';
import pool from '../config/db.js';

import { authRequired } from '../middlewares/validateToken.js';
import salaSchema from '../schemas/salaSchema.js';
import validateSchema from '../middlewares/validateSchema.js';

const router = Router();

router.route("/")
    .post(authRequired, validateSchema(salaSchema), salaController.register)
    .get(authRequired, salaController.getSalas);

router.route("/:id")
    .put(authRequired, salaController.update)
    .get(authRequired, salaController.getSalaById)
    .delete(authRequired, salaController.delete);

// Debug endpoint: listar todas las salas (solo en desarrollo)
if (process.env.NODE_ENV !== 'production') {
    router.get('/debug/all', async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM "Salas" WHERE eliminar = false');
            return res.json(result.rows);
        } catch (err) {
            console.error('Debug GET /apis/sala/debug/all failed:', err);
            return res.status(500).json({ error: true, message: err.message });
        }
    });
}

export default router;
