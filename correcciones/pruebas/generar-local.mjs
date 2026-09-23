import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, mkdtemp, readFile, readdir, writeFile, access } from 'node:fs/promises';

export const raizBackend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const carpetaDiagramas = path.join(raizBackend, 'correcciones/pruebas/diagramas');
const temasEjemplo = ['tienda', 'biblioteca', 'clinica', 'academico', 'bancario', 'gimnasio', 'gimnasio-permisos', 'salud'];
let modulos;

export async function cargarGeneradores() {
  if (modulos) return modulos;
  // El controlador crea su temporal al importarse; fijarlo antes de cualquier import.
  process.env.EXPORT_TMP_DIR = path.join(raizBackend, 'temp/exportaciones-pruebas');
  process.env.DOTENV_CONFIG_QUIET = 'true';
  const { default: dotenv } = await import('dotenv');
  dotenv.config({ path: path.join(raizBackend, '.env'), quiet: true });
  // db.js exige configuración incluso cuando nadie consulta. El Pool es perezoso.
  if (!process.env.DATABASE_URL && !process.env.DB_PASSWORD) {
    process.env.DB_PASSWORD = 'generacion-local-sin-base-de-datos';
  }
  const [{ default: controller }, { default: Spring }, { default: Flutter },
    { TABLEROS_PRUEBA }, { default: pool }] = await Promise.all([
    import('../../src/controllers/crearPagina.controller.clean.js'),
    import('../../src/generators/SpringBootProjectBuilder.js'),
    import('../../src/generators/FlutterProjectBuilder.js'),
    import('../../src/config/tablerosPrueba.js'),
    import('../../src/config/db.js'),
  ]);
  // Una futura consulta accidental falla antes de abrir una conexión o alterar datos.
  const prohibido = () => { throw new Error('La generación local no puede consultar PostgreSQL.'); };
  pool.query = prohibido;
  pool.connect = prohibido;
  modulos = { controller, Spring, Flutter, TABLEROS_PRUEBA };
  return modulos;
}

export async function cargarCasos(temas = []) {
  const { TABLEROS_PRUEBA } = await cargarGeneradores();
  if (TABLEROS_PRUEBA.length !== temasEjemplo.length) {
    throw new Error('Cambió el catálogo de TABLEROS_PRUEBA: actualiza sus nombres en generar-local.mjs.');
  }
  const casos = new Map(TABLEROS_PRUEBA.map((tablero, i) => [temasEjemplo[i], {
    tema: temasEjemplo[i], titulo: tablero.titulo, diagrama: { nodes: tablero.nodes, edges: tablero.edges },
  }]));
  for (const nombre of (await readdir(carpetaDiagramas)).filter(n => n.endsWith('.json')).sort()) {
    const tema = nombre.slice(0, -5);
    casos.set(tema, { tema, titulo: `Prueba ${tema}`, diagrama: JSON.parse(await readFile(path.join(carpetaDiagramas, nombre), 'utf8')) });
  }
  if (temas.length === 0) return [...casos.values()];
  return [...new Set(temas)].map(tema => {
    if (!casos.has(tema)) throw new Error(`Tema desconocido: ${tema}. Disponibles: ${[...casos.keys()].join(', ')}`);
    return casos.get(tema);
  });
}

export async function nuevaCorrida(prefijo = 'generacion') {
  const base = path.join(raizBackend, 'temp/pruebas-local');
  await mkdir(base, { recursive: true });
  const fecha = new Date().toISOString().replace(/[:.]/g, '-');
  return mkdtemp(path.join(base, `${prefijo}-${fecha}-`));
}

export async function generarCaso(caso, salida) {
  const { controller, Spring, Flutter } = await cargarGeneradores();
  if (!/^[a-z0-9-]+$/.test(caso.tema)) throw new Error('El tema contiene caracteres no permitidos.');
  const destino = path.resolve(salida, caso.tema);
  const basePermitida = path.resolve(raizBackend, 'temp/pruebas-local') + path.sep;
  if (!destino.startsWith(basePermitida)) throw new Error('La salida debe permanecer dentro de backend/temp/pruebas-local.');
  try {
    await access(destino);
    throw new Error(`Ya existe la salida de ${caso.tema}; se conserva sin modificar.`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(destino);
  const convertido = controller.convertirFrontendADiagramParser(caso.diagrama.nodes, caso.diagrama.edges, caso.diagrama.permisos ?? null);
  const json = JSON.stringify(convertido);
  const spring = new Spring('spring', json, destino, {
    nombreProyecto: caso.tema, dbName: `prueba_${caso.tema.replaceAll('-', '_')}`, proposito: caso.titulo,
  });
  const flutter = new Flutter('app', json, destino, { nombreApp: caso.tema, proposito: caso.titulo });
  await spring.build();
  await flutter.build();
  await writeFile(path.join(destino, 'diagrama.json'), JSON.stringify(caso.diagrama, null, 2));
  return { tema: caso.tema, titulo: caso.titulo, spring: spring.projectPath, flutter: flutter.projectPath };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Uso: node correcciones/pruebas/generar-local.mjs [tema ...]\nSin temas: cinco tableros de ejemplo y todos los fixtures. No necesita servidor ni PostgreSQL.');
    return;
  }
  const casos = await cargarCasos(args);
  const salida = await nuevaCorrida();
  const manifest = { version: 1, creada: new Date().toISOString(), salida, casos: [], fallos: [] };
  console.log(`Salida: ${salida}`);
  for (const caso of casos) {
    try {
      manifest.casos.push(await generarCaso(caso, salida));
      console.log(`OK: ${caso.tema}`);
    } catch (error) {
      manifest.fallos.push({ tema: caso.tema, mensaje: error.message });
      console.error(`FALLO: ${caso.tema}: ${error.message}`);
    }
    await writeFile(path.join(salida, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
  console.log(`Manifest: ${path.join(salida, 'manifest.json')}`);
  if (manifest.fallos.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
