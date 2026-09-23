import path from 'path';
import FlutterProjectBuilder from '../generators/FlutterProjectBuilder.js';
import { getSalaById } from '../models/sala.model.js';
import CrearPaginaController, { sanitizarNombreProyecto } from './crearPagina.controller.clean.js';
import { response } from '../middlewares/catchedAsync.js';

import os from 'os';
import fs from 'fs';
import { puedeAccederASala } from '../libs/salaAccess.js';
import { describirProyecto } from '../libs/descripcionProyecto.js';

// NOTE: Este valor debe coincidir con la ruta usada por CrearPaginaController
// donde se almacenan proyectos generados temporalmente.
const rutaBase = process.env.EXPORT_TMP_DIR || path.join(os.tmpdir(), 'proyectos');
fs.mkdirSync(rutaBase, { recursive: true });

const FlutterExportController = {
  // Genera un proyecto Flutter a partir de la sala guardada con id
  exportarDesdeSala: async (req, res) => {
    const { id } = req.params || {};
    try {
      const acceso = await puedeAccederASala(req.user && req.user.id, id);
      if (!acceso.ok) return response(res, acceso.status, { error: acceso.message });

      const [sala] = await getSalaById(id);
      if (!sala) return response(res, 404, { error: 'El tablero no existe o fue eliminado.' });
      if (!sala.xml || sala.xml.trim() === '') return response(res, 400, { error: 'El tablero está vacío: agrega al menos una clase antes de exportar.' });

      let salaData;
      try { salaData = JSON.parse(sala.xml); } catch (err) { return response(res, 400, { error: 'El contenido del tablero está dañado y no se puede exportar. Abre el tablero, guárdalo e intenta de nuevo.' }); }

      let elements = [];
      let connections = [];
      // Support both formats: { elements, connections } and legacy { nodes, edges }
      if (salaData.elements) {
        elements = Array.isArray(salaData.elements) ? salaData.elements : Object.values(salaData.elements);
      } else if (salaData.nodes) {
        // frontend stores diagram as nodes/edges in some cases
        elements = Array.isArray(salaData.nodes) ? salaData.nodes : Object.values(salaData.nodes);
      }

      if (salaData.connections) {
        connections = Array.isArray(salaData.connections) ? salaData.connections : Object.values(salaData.connections);
      } else if (salaData.edges) {
        connections = Array.isArray(salaData.edges) ? salaData.edges : Object.values(salaData.edges);
      }

      if (elements.length === 0) return response(res, 400, { error: 'El tablero no tiene clases: agrega al menos una clase para generar la app Flutter.' });

      const projectName = `flutter-project-${sanitizarNombreProyecto(sala.title)}-${Date.now()}`;

      // Convertir formato frontend -> parser interno (reusa función de CrearPaginaController)
      const converted = CrearPaginaController.convertirFrontendADiagramParser(elements, connections, salaData.permisos ?? null);

      // El timestamp solo distingue la carpeta temporal; la app se llama como el tablero
      const proposito = await describirProyecto({
        titulo: sala.title,
        descripcion: sala.description,
        entidades: Object.values(converted.elements || {}),
        relaciones: Object.values(converted.connections || {})
      });
      const builder = new FlutterProjectBuilder(projectName, JSON.stringify(converted), rutaBase, {
        nombreApp: sanitizarNombreProyecto(sala.title).replace(/-/g, '_'),
        proposito
      });
      console.log('🚀 Iniciando generación de proyecto Flutter desde sala con FlutterProjectBuilder...');
      await builder.build();
      console.log('✅ Proyecto Flutter generado exitosamente desde sala');

      // Nota: FlutterProjectBuilder crea la carpeta con sufijo "_flutter"
      const folderName = `${builder.projectName}_flutter`;
      await CrearPaginaController.comprimirProyecto(folderName);
      await CrearPaginaController.enviarZip(res, folderName, `${sanitizarNombreProyecto(sala.title)}-flutter.zip`);
    } catch (error) {
      console.error('❌ Error exportando Flutter desde sala:', error?.message || error);
      if (error?.code === 'PERMISOS_INVALIDOS') return response(res, 400, { error: error.message });
      return response(res, 500, { error: 'No se pudo generar el proyecto Flutter. Revisa que las clases tengan nombre y atributos válidos e intenta de nuevo.' });
    }
  },

  // Genera un proyecto Flutter a partir del payload (elements, connections) enviado en body
  exportarConPayload: async (req, res) => {
    const { elements, connections, permisos } = req.body || {};
    if (!elements || elements.length === 0) return response(res, 400, { error: 'El diagrama no tiene clases: agrega al menos una para generar la app Flutter.' });
    try {
      const projectName = `flutter-project-${Date.now()}`;
      const converted = CrearPaginaController.convertirFrontendADiagramParser(elements, connections || [], permisos ?? null);
  const builder = new FlutterProjectBuilder(projectName, JSON.stringify(converted), rutaBase);
  console.log('🚀 Iniciando generación de proyecto Flutter con FlutterProjectBuilder...');
  await builder.build();
  console.log('✅ Proyecto Flutter generado exitosamente');
  const folderName = `${builder.projectName}_flutter`;
  await CrearPaginaController.comprimirProyecto(folderName);
  await CrearPaginaController.enviarZip(res, folderName);
    } catch (error) {
      console.error('❌ Error generando proyecto Flutter:', error?.message || error);
      if (error?.code === 'PERMISOS_INVALIDOS') return response(res, 400, { error: error.message });
      return response(res, 500, { error: 'No se pudo generar el proyecto Flutter. Intenta de nuevo en unos segundos.' });
    }
  }
};

export default FlutterExportController;
