import path from 'node:path';
import { readFile, readdir, mkdir, open, realpath, stat, copyFile, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { raizBackend } from './generar-local.mjs';
import { comprobarApi } from './comprobar-api.mjs';

let interrumpido = false;

async function manifestReciente() {
  const base = path.join(raizBackend, 'temp/pruebas-local');
  const candidatos = [];
  for (const entrada of await readdir(base, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const archivo = path.join(base, entrada.name, 'manifest.json');
    try { candidatos.push({ archivo, fecha: (await stat(archivo)).mtimeMs }); } catch { /* Corrida incompleta. */ }
  }
  candidatos.sort((a, b) => b.fecha - a.fecha);
  if (!candidatos.length) throw new Error('Primero ejecuta npm run pruebas:generar.');
  return candidatos[0].archivo;
}

async function ejecutar(comando, argumentos, cwd, registro, env) {
  const log = await open(registro, 'a');
  try {
    await log.write(`\n> ${comando} ${argumentos.join(' ')}\n`);
    const windows = process.platform === 'win32';
    // Solo se pasan nombres y opciones fijos. La ruta del proyecto va en cwd, nunca en el shell.
    const ejecutable = windows ? 'cmd.exe' : comando;
    const args = windows ? ['/d', '/s', '/c', `${comando} ${argumentos.join(' ')}`] : argumentos;
    await new Promise((resolve, reject) => {
      const proceso = spawn(ejecutable, args, { cwd, env, windowsHide: true, detached: !windows, stdio: ['ignore', log.fd, log.fd] });
      const detener = () => {
        interrumpido = true;
        if (!proceso.pid || proceso.exitCode !== null) return;
        if (windows) {
          const cerrar = spawn('taskkill.exe', ['/PID', String(proceso.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          cerrar.on('error', () => proceso.kill());
        } else {
          try { process.kill(-proceso.pid, 'SIGTERM'); } catch { proceso.kill(); }
        }
      };
      process.once('SIGINT', detener);
      process.once('SIGTERM', detener);
      const limpiar = () => { process.removeListener('SIGINT', detener); process.removeListener('SIGTERM', detener); };
      proceso.once('error', error => { limpiar(); reject(error); });
      proceso.once('exit', codigo => { limpiar(); codigo === 0 ? resolve() : reject(new Error(`${comando} terminó con código ${codigo}; consulta ${registro}`)); });
    });
  } finally { await log.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const modo = args.shift();
  if (!['backend', 'flutter', 'integracion'].includes(modo) || args.includes('--help')) {
    console.log('Uso: node correcciones/pruebas/verificar-proyectos.mjs backend|flutter|integracion [--manifest ruta/manifest.json] [--con-flutter] [tema ...]\nSin manifest: la corrida más reciente. backend compila; flutter prepara web, analiza y prueba; integracion empaqueta y prueba API contra bases nuevas. --con-flutter añade el contrato real en relaciones-opcionales.');
    if (!['backend', 'flutter', 'integracion'].includes(modo)) process.exitCode = 1;
    return;
  }
  const conFlutter = args.includes('--con-flutter');
  if (conFlutter) args.splice(args.indexOf('--con-flutter'), 1);
  if (conFlutter && modo !== 'integracion') throw new Error('--con-flutter solo se usa con integracion.');
  const bootstrap = args.includes('--bootstrap');
  if (bootstrap) args.splice(args.indexOf('--bootstrap'), 1);
  if (bootstrap && (modo !== 'integracion' || conFlutter)) throw new Error('--bootstrap se usa solo con integracion, sin --con-flutter.');
  const indice = args.indexOf('--manifest');
  let archivo;
  if (indice >= 0) {
    if (!args[indice + 1]) throw new Error('Falta la ruta del manifest.');
    archivo = path.resolve(args[indice + 1]);
    args.splice(indice, 2);
  } else archivo = await manifestReciente();
  const manifest = JSON.parse(await readFile(archivo, 'utf8'));
  if (manifest.fallos?.length) throw new Error('La corrida contiene exportaciones fallidas; vuelve a generar antes de verificar.');
  const casos = manifest.casos.filter(c => args.length === 0 || args.includes(c.tema));
  for (const tema of args) if (!casos.some(c => c.tema === tema)) throw new Error(`No existe ${tema} en el manifest.`);
  if (!casos.length) throw new Error('El manifest no contiene proyectos para comprobar.');
  const basePermitida = (await realpath(path.join(raizBackend, 'temp/pruebas-local'))) + path.sep;
  const env = { ...process.env, DOTENV_CONFIG_QUIET: 'true', CI: 'true' };
  // Conserva el workaround local si existe, sin crear carpetas fuera del repositorio.
  if (process.platform === 'win32') {
    try { if ((await stat('C:\\tmpjava')).isDirectory()) { env.TEMP = 'C:\\tmpjava'; env.TMP = 'C:\\tmpjava'; } } catch { /* Usa el temporal configurado por el usuario. */ }
  }
  const logs = path.join(path.dirname(archivo), 'logs');
  await mkdir(logs, { recursive: true });
  let fallos = 0;
  for (const caso of casos) {
    if (interrumpido) break;
    try {
      for (const tipo of ['spring', 'flutter']) {
        caso[tipo] = await realpath(caso[tipo]);
        if (!caso[tipo].startsWith(basePermitida)) throw new Error('El proyecto sale de backend/temp/pruebas-local.');
      }
      if (!/^[a-z0-9-]+$/.test(caso.tema)) throw new Error('Tema inválido en manifest.');
      const registro = path.join(logs, `${modo}-${caso.tema}.log`);
      if (modo === 'flutter') {
        await ejecutar('flutter', ['create', '.', '--platforms', 'web'], caso.flutter, registro, env);
        await ejecutar('flutter', ['pub', 'get'], caso.flutter, registro, env);
        const pruebasPermisos = [];
        if (caso.tema === 'permisos') {
          for (const archivo of ['permisos_widget_test.dart', 'sesion_http_test.dart']) {
            const destino = path.join(caso.flutter, 'test', `${archivo.slice(0, -10)}_${randomBytes(8).toString('hex')}_test.dart`);
            await copyFile(path.join(raizBackend, 'correcciones/pruebas', archivo), destino, constants.COPYFILE_EXCL);
            pruebasPermisos.push(destino);
          }
        }
        try {
          await ejecutar('flutter', ['analyze'], caso.flutter, registro, env);
          await ejecutar('flutter', ['test'], caso.flutter, registro, env);
        } finally {
          for (const archivo of pruebasPermisos) await unlink(archivo);
        }
      } else {
        // Ruta explícita: con NoDefaultCurrentDirectoryInExePath definido, cmd.exe no busca
        // el wrapper en el directorio del proyecto y respondía que no reconoce el comando.
        const maven = process.platform === 'win32' ? '.\\mvnw.cmd' : 'sh';
        const opcionesMaven = [...(process.platform === 'win32' ? [] : ['./mvnw']), '-B', '-ntp'];
        await ejecutar(maven, [...opcionesMaven, 'compile'], caso.spring, registro, env);
        if (modo === 'integracion') {
          await ejecutar(maven, [...opcionesMaven, '-DskipTests', 'package'], caso.spring, registro, env);
          await comprobarApi(caso, env, {
            alInterrumpir: () => { interrumpido = true; },
            bootstrap,
            ...(conFlutter ? { ejecutarFlutter: argumentos => ejecutar('flutter', argumentos, caso.flutter, registro, env) } : {}),
          });
        }
      }
      console.log(`OK ${modo}: ${caso.tema}`);
    } catch (error) { fallos++; console.error(`FALLO ${caso.tema}: ${error.message}`); }
  }
  console.log(`Comprobaciones fallidas: ${fallos}. Registros: ${logs}`);
  if (fallos || interrumpido) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
