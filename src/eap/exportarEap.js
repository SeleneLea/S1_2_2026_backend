/**
 * Exportación a Enterprise Architect (.EAP) con el diagrama dibujado en el lienzo.
 *
 * Un .EAP es una base Jet 3 (Access 97). No existe una librería que escriba ese formato fuera de
 * Windows, así que se usa el motor de Windows: preparar-plan.mjs calcula las filas que EA 13 guarda
 * al dibujar a mano y escribir-eap.ps1 las inserta por ODBC (driver de Access de 32 bits, incluido
 * en Windows) en una copia de la plantilla vacía. El resultado se abrió y comparó fila por fila con
 * proyectos hechos en EA 13.5.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { especificacionDesdeTablero } from './especificacionDesdeTablero.js';

const CARPETA = path.dirname(fileURLToPath(import.meta.url));
const PLANTILLA = path.join(CARPETA, 'plantilla-vacia.eap');
const PREPARAR = path.join(CARPETA, 'scripts', 'preparar-plan.mjs');
const ESCRIBIR = path.join(CARPETA, 'scripts', 'escribir-eap.ps1');
const LIMITE_MS = 120000;

const ejecutar = (programa, argumentos) => new Promise((resolve, reject) => {
    execFile(programa, argumentos, { timeout: LIMITE_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
            if (error) {
                const detalle = `${stdout || ''}\n${stderr || ''}`.trim();
                return reject(Object.assign(error, { detalle }));
            }
            resolve(stdout);
        });
});

/** ¿Este servidor puede escribir .EAP? Solo Windows trae el driver ODBC de Access. */
export const puedeEscribirEap = () => process.platform === 'win32';

const errorDelUsuario = (mensaje, statusCode) => Object.assign(new Error(mensaje), { statusCode });

/**
 * Genera el .EAP de un tablero y lo devuelve como Buffer.
 * @param {{nodes: object[], edges: object[]}} tablero
 * @param {string} titulo  nombre del tablero (paquete del modelo en EA)
 */
export const generarEap = async (tablero, titulo) => {
    if (!puedeEscribirEap()) {
        throw errorDelUsuario(
            'La exportación a .EAP necesita el motor de Access de Windows y este servidor no lo tiene. '
            + 'Úsala desde la aplicación instalada en tu PC con Windows, o exporta XMI 2.1: en Enterprise '
            + 'Architect se abre con clic derecho en el paquete → Import Model from XMI.', 501);
    }
    const especificacion = especificacionDesdeTablero(tablero, titulo);
    const carpeta = await mkdtemp(path.join(os.tmpdir(), 'eap-'));
    const archivoSpec = path.join(carpeta, 'especificacion.json');
    const archivoPlan = path.join(carpeta, 'plan.json');
    const archivoEap = path.join(carpeta, 'modelo.eap');
    try {
        await writeFile(archivoSpec, JSON.stringify(especificacion), 'utf8');
        await ejecutar(process.execPath, [PREPARAR, archivoSpec, archivoPlan]);
        await ejecutar('powershell.exe', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ESCRIBIR,
            '-Plan', archivoPlan, '-Base', PLANTILLA, '-Salida', archivoEap,
        ]);
        return await readFile(archivoEap);
    } catch (error) {
        console.error('Exportación EAP fallida:', error.detalle || error.message);
        if (error.statusCode) throw error;
        if (/driver|ODBC|IM002/i.test(error.detalle || '')) {
            throw errorDelUsuario(
                'Windows no tiene el driver ODBC de Access de 32 bits ("Microsoft Access Driver (*.mdb)"), '
                + 'que hace falta para escribir el .EAP.', 501);
        }
        throw errorDelUsuario('No se pudo generar el archivo de Enterprise Architect. Revisa que las clases tengan nombre e intenta de nuevo.', 500);
    } finally {
        await rm(carpeta, { recursive: true, force: true }).catch(() => {});
    }
};
