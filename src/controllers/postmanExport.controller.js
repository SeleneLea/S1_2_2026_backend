import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import archiver from 'archiver';
import { response } from '../middlewares/catchedAsync.js';
import { getSalaById } from '../models/sala.model.js';
import { puedeAccederASala } from '../libs/salaAccess.js';
import SpringBootProjectBuilder from '../generators/SpringBootProjectBuilder.js';
import CrearPaginaController, { nombreBaseDatos, sanitizarNombreProyecto } from './crearPagina.controller.clean.js';
import { escribirPostman } from '../postman/postmanDesdeProyecto.js';

const comprimirCarpeta = (carpeta) => new Promise((resolve, reject) => {
    const partes = [];
    const zip = archiver('zip', { zlib: { level: 9 } });
    zip.on('data', (parte) => partes.push(parte));
    zip.on('end', () => resolve(Buffer.concat(partes)));
    zip.on('error', reject);
    zip.directory(carpeta, false);
    zip.finalize();
});

/**
 * POST /apis/crearPagina/exportarPostman/:id → ZIP con la colección de Postman y la guía
 * COMO_LLAMAR_LA_API.txt. Se genera el backend del tablero en una carpeta temporal y se leen
 * de ahí las rutas, los campos y las cuentas, para que coincidan con el proyecto exportado.
 */
export const exportarPostmanDesdeSala = async (req, res) => {
    const { id } = req.params;
    let temporal = null;
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
        const elementos = Array.isArray(tablero.nodes) ? tablero.nodes : Object.values(tablero.nodes || tablero.elements || {});
        const conexiones = Array.isArray(tablero.edges) ? tablero.edges : Object.values(tablero.edges || tablero.connections || {});
        if (!elementos.length) return response(res, 400, { error: 'El diagrama no tiene clases para generar la colección de Postman.' });

        const nombre = sanitizarNombreProyecto(sala.title);
        const convertido = CrearPaginaController.convertirFrontendADiagramParser(elementos, conexiones, tablero.permisos ?? null);
        temporal = await mkdtemp(path.join(os.tmpdir(), 'postman-'));
        const builder = new SpringBootProjectBuilder('proyecto', JSON.stringify(convertido), temporal, {
            dbName: nombreBaseDatos(sala.title),
            nombreProyecto: nombre,
        });
        await builder.build();
        escribirPostman(path.join(temporal, 'proyecto'), nombre);

        const zip = await comprimirCarpeta(path.join(temporal, 'proyecto', 'postman'));
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${nombre}-postman.zip"`);
        return res.send(zip);
    } catch (error) {
        console.error('Exportación Postman fallida:', error?.message || error);
        if (error?.code === 'PERMISOS_INVALIDOS') return response(res, 400, { error: error.message });
        return response(res, 500, { error: 'No se pudo generar la colección de Postman. Revisa que las clases tengan nombre y atributos válidos.' });
    } finally {
        if (temporal) await rm(temporal, { recursive: true, force: true }).catch(() => {});
    }
};
