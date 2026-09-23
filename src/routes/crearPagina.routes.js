import { Router } from 'express';
import CrearPaginaController from '../controllers/crearPagina.controller.clean.js';
import FlutterExportController from '../controllers/flutterExport.controller.js';
import { eapDisponible, exportarEapDesdeSala } from '../controllers/eapExport.controller.js';
import { exportarPostmanDesdeSala } from '../controllers/postmanExport.controller.js';
import { authRequired } from '../middlewares/validateToken.js';

const router = Router();

router.post('/exportarSpringBoot/:id', authRequired, CrearPaginaController.exportarSpringBootDesdeSala);

// Disabled: export by payload is intentionally removed to force export by sala id only.
// If you need to re-enable payload-based export, add a secured route that validates input and size.

router.post('/exportarSQL/:id', authRequired, CrearPaginaController.exportarSQLDesdeSala);

router.post('/exportarFlutter/:id', authRequired, FlutterExportController.exportarDesdeSala);
router.post('/exportarFlutter', authRequired, FlutterExportController.exportarConPayload);

// Enterprise Architect: proyecto .EAP con el diagrama dibujado (necesita Windows en el servidor)
router.get('/eapDisponible', authRequired, eapDisponible);
router.post('/exportarEAP/:id', authRequired, exportarEapDesdeSala);

// Postman: colección + COMO_LLAMAR_LA_API.txt, leídas del backend generado del tablero
router.post('/exportarPostman/:id', authRequired, exportarPostmanDesdeSala);

// Keep explicit id-based export route. The generic endpoint that accepted payloads is disabled
// to enforce server-side export only by saved sala id.
router.post('/:id', authRequired, CrearPaginaController.exportar);

export default router;
