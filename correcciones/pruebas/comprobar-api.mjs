import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { raizBackend } from './generar-local.mjs';
import { comprobarPermisos } from './comprobar-permisos.mjs';
import { comprobarPermisosMN } from './comprobar-permisos-mn.mjs';

const espera = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function comprobarApi(caso, entorno = process.env, { ejecutarFlutter, alInterrumpir, bootstrap = false, comprobacionesExtra } = {}) {
  const { default: dotenv } = await import('dotenv');
  dotenv.config({ path: path.join(raizBackend, '.env'), quiet: true });
  const { default: pg } = await import('pg');
  const configuracion = {
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD, database: 'postgres',
    connectionTimeoutMillis: 15000,
  };
  // Esta prueba usa DB_* local y crea una base nueva; no usa DATABASE_URL de producción.
  assert.ok(configuracion.password, 'Configura DB_PASSWORD para la integración local.');
  const cliente = new pg.Client(configuracion);
  const base = `prueba_gen_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const contexto = caso.tema === 'validaciones' ? '/prueba' : '';
  const escenario = bootstrap ? 'bootstrap' : 'integracion';
  const puerto = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  let proceso, token, log, terminado = false, arrancado = false;
  const api = async (ruta, metodo = 'GET', cuerpo, credencial = token) => {
    const respuesta = await fetch(`http://127.0.0.1:${puerto}${contexto}/api${ruta}`, {
      method: metodo, headers: { 'Content-Type': 'application/json', ...(credencial ? { Authorization: `Bearer ${credencial}` } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(15000),
    });
    const texto = await respuesta.text();
    let datos;
    try { datos = JSON.parse(texto); } catch { datos = {}; }
    return { estado: respuesta.status, ...datos };
  };
  let apagado;
  const detener = () => {
    terminado = true;
    if (apagado) return apagado;
    apagado = (async () => {
      if (!proceso?.pid || proceso.exitCode !== null) return;
      if (process.platform === 'win32') {
        // java.exe de Oracle javapath puede ser un launcher con otro java.exe hijo.
        // Cerrar su árbol antes del launcher evita dejar el JAR huérfano.
        await new Promise((resolve, reject) => {
          const cerrar = spawn('taskkill.exe', ['/PID', String(proceso.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          cerrar.once('error', reject);
          cerrar.once('exit', codigo => codigo === 0 || codigo === 128
            ? resolve() : reject(new Error(`No se pudo detener el árbol Java de esta prueba (código ${codigo}).`)));
        });
      } else {
        try { process.kill(-proceso.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      if (proceso.exitCode === null) await Promise.race([once(proceso, 'exit').catch(() => {}), espera(5000)]);
      if (proceso.exitCode === null && proceso.signalCode === null) {
        if (process.platform === 'win32') throw new Error('El árbol Java no terminó después de taskkill.');
        try { process.kill(-proceso.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    })();
    return apagado;
  };
  const interrumpir = () => { alInterrumpir?.(); void detener().catch(() => {}); };
  process.once('SIGINT', interrumpir);
  process.once('SIGTERM', interrumpir);
  try {
    await cliente.connect();
    assert.match(base, /^prueba_gen_\d+_[a-f0-9]{8}$/);
    await cliente.query(`CREATE DATABASE "${base}"`);
    await fs.promises.writeFile(path.join(caso.spring, `${escenario}.json`), JSON.stringify({ tema: caso.tema, base, puerto, escenario }, null, 2));
    const jars = (await fs.promises.readdir(path.join(caso.spring, 'target'))).filter(n => n.endsWith('.jar'));
    assert.equal(jars.length, 1, 'Empaqueta el backend antes de probar su API.');
    log = fs.createWriteStream(path.join(caso.spring, `${escenario}.log`));
    proceso = spawn('java', ['-jar', path.join(caso.spring, 'target', jars[0])], {
      cwd: caso.spring, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...entorno, SERVER_PORT: String(puerto), SERVER_SERVLET_CONTEXT_PATH: contexto, AUTH_DEMO: bootstrap ? 'false' : 'true', AUTH_DEMO_CLAVE: '12345678',
        ...(bootstrap ? { AUTH_INICIAL_CORREO: 'administracion-inicial@prueba.test', AUTH_INICIAL_CLAVE: '12345678' } : {}),
        SPRING_DATASOURCE_URL: `jdbc:postgresql://${configuracion.host}:${configuracion.port}/${base}`,
        SPRING_DATASOURCE_USERNAME: configuracion.user, SPRING_DATASOURCE_PASSWORD: configuracion.password },
    });
    let errorArranque;
    proceso.on('error', error => { errorArranque = error; });
    for (const stream of [proceso.stdout, proceso.stderr]) stream.on('data', chunk => {
      log.write(chunk);
      if (chunk.toString().includes('Started DemoApplication')) arrancado = true;
    });
    let listo = false;
    for (let i = 0; i < 120; i++) {
      if (terminado) throw new Error('Prueba interrumpida.');
      if (errorArranque) throw errorArranque;
      if (proceso.exitCode !== null) throw new Error('El backend terminó antes de arrancar; consulta integracion.log.');
      try { if (arrancado && (await api('/auth/roles')).estado === 200) { listo = true; break; } } catch { /* El servidor todavía está arrancando. */ }
      await espera(1000);
    }
    assert.ok(listo, 'El backend no arrancó; consulta integracion.log.');
    const roles = await api('/auth/roles');
    if (bootstrap) {
      const acceso = await api('/auth/login', 'POST', { correo: 'administracion-inicial@prueba.test', clave: '12345678' });
      assert.equal(acceso.estado, 200, 'La cuenta inicial sin demo permite iniciar sesión');
      assert.equal(acceso.data.rol, 'ADMIN', 'La cuenta inicial es administradora, no un gestor de negocio sin vínculo');
      token = acceso.data.token;
      assert.equal((await api('/cuentas')).data.length, 1, 'Solo se creó la cuenta inicial');
      assert.equal((await api('/plan')).estado, 200);
      assert.equal((await api('/auth/login', 'POST', { correo: 'admin@demo.com', clave: '12345678' })).estado, 401);
      console.log(`OK bootstrap ${caso.tema}: AUTH_DEMO=false, administrador inicial y acceso a cuentas/API. Base conservada: ${base}`);
      return;
    }
    const gestor = roles.data.roles.includes('ADMIN') ? 'ADMIN' : roles.data.gestores[0];
    const login = await api('/auth/login', 'POST', { correo: `${gestor.toLowerCase()}@demo.com`, clave: '12345678' });
    assert.equal(login.estado, 200, 'Inicio de sesión demo');
    token = login.data.token;
    assert.equal((await api('/auth/yo', 'GET', undefined, null)).estado, 401);
    assert.equal((await api('/auth/registro', 'POST', { correo: 'gestor-nuevo@test.com', clave: '12345678', rol: gestor })).estado, 400);
    assert.equal((await api('/cuentas', 'POST', { correo: 'creado@test.com', clave: '12345678', rol: gestor, nombre: 'Prueba' })).estado, 201);
    const cuentas = await api('/cuentas');
    assert.equal(cuentas.estado, 200);
    assert.ok(cuentas.data.every(c => !('clave' in c) && !('token' in c)));
    let tokenConsulta;
    if (roles.data.registroPublico.length) {
      const alta = await api('/auth/registro', 'POST', { correo: 'consulta@test.com', clave: '12345678', rol: roles.data.registroPublico[0], nombre: 'Consulta' });
      assert.equal(alta.estado, 201);
      tokenConsulta = alta.data.token;
      assert.equal((await api('/cuentas', 'GET', undefined, tokenConsulta)).estado, 403);
      assert.equal((await api('/cuentas', 'POST', {}, tokenConsulta)).estado, 403);
      assert.equal((await api('/cuentas;foo=bar', 'GET', undefined, tokenConsulta)).estado, 403);
    }
    const directorio = path.join(caso.spring, 'src/main/java/com/example/demo/controllers');
    const rutas = fs.readdirSync(directorio).filter(n => n.endsWith('Controller.java')).flatMap(nombre => {
      const codigo = fs.readFileSync(path.join(directorio, nombre), 'utf8');
      return codigo.includes('mapper.toDTOList') ? [codigo.match(/@RequestMapping\("\/api([^"]+)"\)/)?.[1]] : [];
    }).filter(Boolean);
    assert.ok(rutas.length > 0, 'No se encontraron controladores CRUD.');
    for (const ruta of rutas) {
      const lista = await api(ruta);
      assert.equal(lista.estado, 200, ruta);
      assert.ok(lista.data.length > 0, `${ruta} sin datos sembrados`);
      assert.equal((await api(ruta, 'GET', undefined, null)).estado, 401);
      if (tokenConsulta) assert.equal((await api(ruta, 'POST', {}, tokenConsulta)).estado, 403);
      const pagina = await api(`${ruta}?pagina=0&tamano=1`);
      assert.equal(pagina.estado, 200);
      assert.equal(pagina.data.length, 1);
      assert.equal(pagina.total, lista.total);
      const uno = lista.data[0];
      for (const clave of Object.keys(uno).filter(k => k.endsWith('Ids') && Array.isArray(uno[k]))) {
        const antes = uno[clave];
        assert.equal((await api(`${ruta}/${uno.id}`, 'PATCH', {})).estado, 200);
        assert.deepEqual((await api(`${ruta}/${uno.id}`)).data[clave], antes, 'PATCH omitido conserva relaciones');
        assert.equal((await api(`${ruta}/${uno.id}`, 'PUT', { ...uno, [clave]: [] })).estado, 200);
        assert.deepEqual((await api(`${ruta}/${uno.id}`)).data[clave], [], 'PUT vacía relaciones');
        assert.equal((await api(`${ruta}/${uno.id}`, 'PATCH', { [clave]: antes })).estado, 200);
        assert.deepEqual((await api(`${ruta}/${uno.id}`)).data[clave], antes);
        assert.equal((await api(`${ruta}/${uno.id}`, 'PATCH', { [clave]: [] })).estado, 200);
        assert.deepEqual((await api(`${ruta}/${uno.id}`)).data[clave], [], 'PATCH [] vacía relaciones');
      }
    }
    const altasSinId = {
      tienda: ['/producto', { nombre: 'Alta desde prueba', precio: 12.5, stock: 4 }],
      biblioteca: ['/autor', { nombre: 'Autor de prueba', nacionalidad: 'Boliviana' }],
      clinica: ['/especialidad', { nombre: 'Especialidad de prueba', descripcion: 'Nueva especialidad' }],
      academico: ['/aula', { codigo: 'PRUEBA-ALTA', capacidad: 30 }],
      bancario: ['/sucursal', { nombre: 'Sucursal de prueba', direccion: 'Calle de prueba', ciudad: 'La Paz' }],
      'nombres-conflictivos': ['/usuario', { nombre: 'Usuario del dominio', codigoNegocio: 'DOM-ALTA' }],
      'relaciones-opcionales': ['/producto', { nombre: 'Producto sin relaciones', precio: 12.5 }],
      'herencia-profunda': ['/gerente', { nombre: 'Gerente nuevo', correo: 'alta-gerente@test.com', legajo: 'ALTA-GERENTE', salario: 1200, area: 'Pruebas', nivel: 2 }],
      'fechas-y-horas': ['/agenda', { nombre: 'Agenda de prueba', fecha: '2026-09-21', creadaEn: '2026-09-21T12:30:00', hora: '12:30' }],
    };
    if (altasSinId[caso.tema]) {
      const [ruta, datos] = altasSinId[caso.tema];
      const alta = await api(ruta, 'POST', datos);
      assert.equal(alta.estado, 201, `Crear en ${ruta} sin enviar id`);
      assert.ok(alta.data.id !== null && alta.data.id !== undefined, 'La base asigna el ID');
      assert.equal((await api(`${ruta}/${alta.data.id}`)).estado, 200);
    }
    if (caso.tema === 'relaciones-opcionales') {
      const lista = await api('/pedido');
      const pedido = lista.data[0];
      assert.equal((await api(`/pedido/${pedido.id}`, 'PUT', { ...pedido, clienteId: null })).estado, 200);
      assert.ok((await api(`/pedido/${pedido.id}`)).data.clienteId == null, 'PUT null elimina FK opcional');
      const datos = new pg.Client({ ...configuracion, database: base });
      try {
        await datos.connect();
        await datos.query("INSERT INTO producto (nombre, precio) SELECT 'Carga ' || lpad(n::text, 5, '0'), n FROM generate_series(1, 5000) n");
      } finally { await datos.end(); }
      const primera = await api('/producto?pagina=0&tamano=50&buscar=Carga&orden=nombre,asc');
      const segunda = await api('/producto?pagina=1&tamano=50&buscar=Carga&orden=nombre,asc');
      assert.equal(primera.estado, 200);
      assert.equal(primera.total, 5000);
      assert.equal(primera.data.length, 50);
      assert.equal(primera.hayMas, true);
      assert.equal(primera.data[0].nombre, 'Carga 00001');
      assert.equal(segunda.data[0].nombre, 'Carga 00051');
      const ultima = await api('/producto?pagina=99&tamano=50&buscar=Carga');
      assert.equal(ultima.hayMas, false);
      assert.equal((await api('/producto?pagina=-1&tamano=50')).estado, 400);
      assert.equal((await api('/producto?pagina=2147483647&tamano=200')).estado, 400);
      assert.equal((await api('/producto?pagina=0&tamano=50&orden=desconocido')).estado, 400);
      if (ejecutarFlutter) {
        const nombre = `contrato_api_${randomBytes(8).toString('hex')}_test.dart`;
        const destino = path.join(caso.flutter, 'test', nombre);
        await fs.promises.copyFile(path.join(raizBackend, 'correcciones/pruebas/integracion_api_test.dart'), destino, fs.constants.COPYFILE_EXCL);
        try {
          await ejecutarFlutter(['test', `test/${nombre}`, `--dart-define=API_URL=http://127.0.0.1:${puerto}${contexto}/api`]);
          console.log('OK contrato Flutter → Spring: login, crear, paginar, vaciar relaciones, consultar y borrar.');
        } finally {
          // Solo este archivo temporal que acabamos de crear, nunca otro test del usuario.
          await fs.promises.unlink(destino);
        }
      }
    }
    if (caso.tema === 'validaciones') {
      const medicion = { temperatura: -12.5, codigo: 'REV-UNICO', porcentaje: 30, tomadaEn: '2026-09-21' };
      const alta = await api('/medicion', 'POST', medicion);
      assert.equal(alta.estado, 201, 'Crear sin id con un valor negativo permitido');
      assert.ok(alta.data.observacion == null);
      assert.equal((await api('/medicion', 'POST', { ...medicion, codigo: 'REV-RANGO', temperatura: 120 })).estado, 400);
      assert.equal((await api('/medicion', 'POST', medicion)).estado, 409);
    }
    if (caso.tema === 'permisos') {
      await comprobarPermisos({ api, pg, configuracion, base });
    }
    if (caso.tema === 'permisos-mn') await comprobarPermisosMN({ api });
    if (comprobacionesExtra) await comprobacionesExtra({ api, pg, configuracion, base });
    console.log(`OK ${caso.tema}: API, siembra, ${rutas.length} endpoints, permisos, paginación y relaciones. Base conservada: ${base}`);
  } finally {
    try {
      await detener();
    } finally {
      log?.end();
      await cliente.end().catch(() => {});
      process.removeListener('SIGINT', interrumpir);
      process.removeListener('SIGTERM', interrumpir);
    }
  }
}
