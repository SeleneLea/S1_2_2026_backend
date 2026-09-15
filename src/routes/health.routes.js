import { Router } from 'express';
import pool from '../config/db.js';

const router = Router();

router.get('/db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as now');
    return res.json({ success: true, now: result.rows[0].now });
  } catch (err) {
    console.error('Health DB check failed:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
