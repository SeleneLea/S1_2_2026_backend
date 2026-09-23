import { response } from '../middlewares/catchedAsync.js';
import { getSalaById } from '../models/sala.model.js';
import { puedeAccederASala } from '../libs/salaAccess.js';
import { generarEap, puedeEscribirEap } from '../eap/exportarEap.js';
import { sanitizarNombreProyecto } from './crearPagina.controller.clean.js';

/** POST /apis/crearPagina/exportarEAP/:id → proyecto .EAP de Enterprise Architect con el diagrama. */
export const exportarEapDesdeSala = async (req, res) => {
    const { id } = req.params;
    try {
        const acceso = await puedeAccederASala(req.user && req.user.id, id);
        if (!acceso.ok) return response(res, acceso.status, { error: acceso.message });

        const [sala] = await getSalaById(id);
        if (!sala) return response(res, 404, { error: 'El tablero no existe o fue eliminado.' });
        if (!sala.xml || sala.xml.trim() === '') {
            return response(res, 400, { error: 'El tablero está vacío: agrega al menos una clase antes de exportar.' });
        }
        let tablero;
        try { tablero = JSON.parse(sala.xml); } catch {
            return response(res, 400, { error: 'El contenido del tablero está dañado y no se puede exportar. Abre el tablero, guárdalo e intenta de nuevo.' });
        }
        const nodes = Array.isArray(tablero.nodes) ? tablero.nodes : Object.values(tablero.nodes || tablero.elements || {});
        const edges = Array.isArray(tablero.edges) ? tablero.edges : Object.values(tablero.edges || tablero.connections || {});

        const eap = await generarEap({ nodes, edges }, sala.title);
        res.setHeader('Content-Type', 'application/vnd.ms-access');
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizarNombreProyecto(sala.title)}.eap"`);
        return res.send(eap);
    } catch (error) {
        return response(res, error.statusCode || 500, {
            error: error.statusCode ? error.message : 'No se pudo generar el archivo de Enterprise Architect.',
        });
    }
};

/** GET /apis/crearPagina/eapDisponible → si este servidor puede escribir .EAP (lo usa el botón). */
export const eapDisponible = (req, res) => response(res, 200, { disponible: puedeEscribirEap() });
