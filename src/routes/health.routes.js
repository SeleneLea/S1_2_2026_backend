import { Router } from 'express';
import pool from '../config/db.js';

const router = Router();

router.get('/db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as now');
    // commit: versión desplegada (Render define RENDER_GIT_COMMIT), útil para confirmar un despliegue
    return res.json({ success: true, now: result.rows[0].now, commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null });
  } catch (err) {
    console.error('Health DB check failed:', err);
    return res.status(500).json({ success: false, error: 'La base de datos no responde.' });
  }
});

export default router;
