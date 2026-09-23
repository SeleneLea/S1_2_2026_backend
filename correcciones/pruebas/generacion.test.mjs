import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { cargarCasos, cargarGeneradores, generarCaso, nuevaCorrida } from './generar-local.mjs';

let casos, controller, salidas;
const leer = (caso, relativa, tipo = 'spring') => readFile(path.join(salidas.get(caso)[tipo], relativa), 'utf8');
const java = relativa => `src/main/java/com/example/demo/${relativa}`;
// Extrae un método completo para no confundir PUT, PATCH y create en la misma clase.
function metodo(texto, firma) {
  const inicio = texto.indexOf(firma);
  assert.ok(inicio >= 0, `No se encontró ${firma}`);
  const apertura = texto.indexOf('{', inicio);
  let nivel = 1, fin = apertura + 1;
  for (; nivel && fin < texto.length; fin++) {
    if (texto[fin] === '{') nivel++;
    if (texto[fin] === '}') nivel--;
  }
  assert.equal(nivel, 0, `Método sin cerrar: ${firma}`);
  return texto.slice(apertura + 1, fin - 1);
}

before(async () => {
  ({ controller } = await cargarGeneradores());
  casos = await cargarCasos();
  salidas = new Map();
  const salida = await nuevaCorrida('regresion');
  const logs = [];
  const logOriginal = console.log;
  console.log = (...args) => logs.push(args.map(String).join(' '));
  try {
    for (const caso of casos) salidas.set(caso.tema, await generarCaso(caso, salida));
  } finally {
    console.log = logOriginal;
    await writeFile(path.join(salida, 'generacion.log'), logs.join('\n'));
  }
  await writeFile(path.join(salida, 'manifest.json'), JSON.stringify({ version: 1, salida, casos: [...salidas.values()], fallos: [] }, null, 2));
});

test('el catálogo incluye ocho tableros reales y siete diagramas difíciles', () => {
  assert.deepEqual([...salidas.keys()].sort(), ['tienda', 'biblioteca', 'clinica', 'academico', 'bancario', 'gimnasio', 'gimnasio-permisos', 'salud', 'nombres-conflictivos', 'relaciones-opcionales', 'validaciones', 'herencia-profunda', 'fechas-y-horas', 'permisos', 'permisos-mn'].sort());
});

test('01: Usuario conserva su atributo y su tipo de ID; la cuenta de acceso ocupa otra tabla', async () => {
  const usuario = await leer('nombres-conflictivos', java('entities/Usuario.java'));
  assert.match(usuario, /getCodigoNegocio\(/);
  assert.match(usuario, /Integer\s+id/);
  const carpeta = path.join(salidas.get('nombres-conflictivos').spring, java('entities'));
  const tablas = [];
  for (const nombre of await readdir(carpeta)) {
    const contenido = await readFile(path.join(carpeta, nombre), 'utf8');
    const tabla = contenido.match(/@Table\(name\s*=\s*"([^"]+)"/);
    if (tabla) tablas.push(tabla[1].toLowerCase());
  }
  assert.equal(new Set(tablas).size, tablas.length, 'La cuenta de acceso no debe compartir tabla con el dominio');
  assert.match(await leer('nombres-conflictivos', java('services/AuthService.java')), /interface AuthService/);
});

test('01: Base no sobrescribe BaseService ni ApiException de Flutter', async () => {
  assert.match(await leer('nombres-conflictivos', 'lib/services/base_service.dart', 'flutter'), /class BaseService/);
  assert.match(await leer('nombres-conflictivos', 'lib/services/base_service.dart', 'flutter'), /class ApiException/);
  const carpeta = path.join(salidas.get('nombres-conflictivos').flutter, 'lib/services');
  const servicios = [];
  for (const nombre of await readdir(carpeta)) {
    const contenido = await readFile(path.join(carpeta, nombre), 'utf8');
    if (contenido.includes("import '../models/base.dart';")) servicios.push(nombre);
  }
  assert.equal(servicios.length, 1, 'Debe existir un servicio CRUD para Base');
  assert.notEqual(servicios[0], 'base_service.dart');
});

test('02: registro público excluye gestores, demo tiene interruptor y cada exportación obtiene secreto propio', async () => {
  const { propiedadesAuth, servicioAuth } = await import('../../src/generators/AuthGenerator.js');
  const roles = [{ rol: 'ADMIN', gestor: true }, { rol: 'CLIENTE', gestor: false }];
  const primero = propiedadesAuth(roles), segundo = propiedadesAuth(roles);
  assert.match(primero, /app\.auth\.roles-registro-publico=CLIENTE(?:\r?\n)/);
  assert.match(primero, /app\.auth\.cuentas-demo=\$\{AUTH_DEMO:/);
  const secreto = texto => texto.match(/app\.auth\.secreto=\$\{AUTH_SECRET:([^}]+)\}/)?.[1];
  assert.ok(secreto(primero)?.length >= 48);
  assert.notEqual(secreto(primero), secreto(segundo));
  const codigo = servicioAuth(roles);
  const permitidos = metodo(codigo, 'rolesQueSeRegistran()');
  assert.match(permitidos, /!puedeGestionar/);
  const registrar = metodo(codigo, ' registrar(');
  assert.ok(registrar.indexOf('permitidos.contains') < registrar.indexOf('crearCuenta('), 'Se comprueba el rol antes de persistir');
});

test('03: PUT reemplaza las relaciones y PATCH solo combina las recibidas, incluida una lista vacía', async () => {
  const producto = await leer('relaciones-opcionales', java('services/ProductoServiceImpl.java'));
  assert.match(metodo(producto, ' update('), /reemplazarCampos\(existing, entity\)/);
  assert.match(metodo(producto, ' partialUpdate('), /combinarCampos\(existing, entity\)/);
  const reemplazar = metodo(producto, 'void reemplazarCampos(');
  assert.match(reemplazar, /existing\.setCategorias\(updated\.getCategorias\(\)\)/);
  assert.doesNotMatch(reemplazar, /if \(updated\.getCategorias\(\) != null\)/);
  const combinar = metodo(producto, 'void combinarCampos(');
  assert.match(combinar, /if \(updated\.getCategorias\(\) != null\)/);
  assert.doesNotMatch(combinar, /getCategorias\(\)\.isEmpty/);
  const pedido = await leer('relaciones-opcionales', java('services/PedidoServiceImpl.java'));
  assert.match(metodo(pedido, 'void reemplazarCampos('), /existing\.setCliente\(updated\.getCliente\(\)\)/);
  assert.doesNotMatch(metodo(pedido, 'void reemplazarCampos('), /if \(updated\.getCliente\(\) != null\)/);
});

test('03: mapper mantiene una relación omitida en PATCH y distingue omisión de [] al convertir DTO', async () => {
  const mapper = await leer('relaciones-opcionales', java('mappers/ProductoMapper.java'));
  const crear = metodo(mapper, 'Producto toEntity(');
  assert.match(crear, /dto\.getCategoriaIds\(\) != null/);
  assert.match(crear, /else\s*\{\s*entity\.setCategorias\(null\)/);
  const actualizar = metodo(mapper, 'void updateEntityFromDTO(');
  assert.match(actualizar, /dto\.getCategoriaIds\(\) != null/);
  assert.doesNotMatch(actualizar, /entity\.setCategorias\(null\)/, 'Un PATCH sin categoriaIds conserva sus relaciones');
});

test('04: las restricciones UML llegan al parser, DTO, columna única y formulario Flutter', async () => {
  const caso = casos.find(c => c.tema === 'validaciones');
  const convertido = controller.convertirFrontendADiagramParser(caso.diagrama.nodes, caso.diagrama.edges);
  const attrs = convertido.elements.medicion.attributes;
  assert.equal(attrs.find(a => a.name === 'observacion').obligatorio, false);
  assert.equal(attrs.find(a => a.name === 'temperatura').minimo, -50);
  assert.equal(attrs.find(a => a.name === 'temperatura').maximo, 80);
  assert.equal(attrs.find(a => a.name === 'codigo').unico, true);
  assert.equal(attrs.find(a => a.name === 'codigo').maximo, 20);
  const dto = await leer('validaciones', java('dto/MedicionDTO.java'));
  assert.match(dto, /@DecimalMin\(value = "-50"/);
  assert.match(dto, /@DecimalMax\(value = "80"/);
  const entidad = await leer('validaciones', java('entities/Medicion.java'));
  assert.match(entidad, /@Column\([^\n]*name = "codigo"[^\n]*unique = true/);
  const formulario = await leer('validaciones', 'lib/screens/medicion_form_screen.dart', 'flutter');
  assert.match(formulario, /-50/);
  assert.match(formulario, /80/);
});

test('05: sesión local verifica vence, HTTP tiene plazo y un 401 navega al acceso', async () => {
  const auth = await leer('tienda', 'lib/services/auth_service.dart', 'flutter');
  assert.match(auth, /base64Url\.decode/);
  assert.match(auth, /datos\['vence'\]/);
  assert.match(auth, /vencimiento\?\.isAfter\(DateTime\.now\(\)\)/);
  assert.match(auth, /if \(!haySesion\)\s*(?:\{\s*)?await cerrarSesion\(\)/);
  assert.ok((auth.match(/\.timeout\(ApiConfig\./g) || []).length >= 2);
  const servicio = await leer('tienda', 'lib/services/base_service.dart', 'flutter');
  assert.match(servicio, /peticion\(\)\.timeout\(ApiConfig\./);
  assert.match(servicio, /statusCode == 401[\s\S]*?AuthService\.terminarSesion\(\)/);
  const main = await leer('tienda', 'lib/main.dart', 'flutter');
  assert.match(main, /navigatorKey:/);
  assert.match(main, /pushAndRemoveUntil\([\s\S]*?LoginScreen/);
});

test('07: tres niveles de herencia conservan id y atributos del abuelo', async () => {
  const entidad = await leer('herencia-profunda', java('entities/Gerente.java'));
  assert.match(entidad, /class Gerente extends Empleado/);
  const mapper = await leer('herencia-profunda', java('mappers/GerenteMapper.java'));
  for (const campo of ['Id', 'Nombre', 'Correo', 'Legajo']) assert.match(mapper, new RegExp(`dto.set${campo}\\(entity.get${campo}\\(\\)\\)`));
  const seed = await leer('herencia-profunda', java('config/DatosDemo.java'));
  assert.match(seed, /new Gerente\(\)/);
  assert.match(seed, /setNombre\(/);
  const correos = [...seed.matchAll(/\.setCorreo\("([^"]+)"\)/g)].map(m => m[1]);
  assert.ok(correos.length >= 3, 'Debe haber valores para las tres entidades de la jerarquía');
  assert.equal(new Set(correos).size, correos.length, 'La columna única del padre también alcanza a sus descendientes');
});

test('07: fecha, fecha y hora y hora sin fecha mantienen sus tipos JSON', async () => {
  const modelo = await leer('fechas-y-horas', 'lib/models/agenda.dart', 'flutter');
  assert.match(modelo, /DateTime\?\s+fecha/);
  assert.match(modelo, /DateTime\?\s+creadaEn/);
  assert.match(modelo, /String\?\s+horaFin/);
  const entidad = await leer('fechas-y-horas', java('entities/Agenda.java'));
  assert.match(entidad, /LocalDate\s+fecha/);
  assert.match(entidad, /LocalDateTime\s+creadaEn/);
  assert.match(entidad, /LocalTime\s+horaFin/);
});

test('04: valores únicos decimales sembrados respetan mínimos con más de dos decimales', async () => {
  const { datosDemo } = await import('../../src/generators/SeedGenerator.js');
  const codigo = datosDemo('Precisión', [{
    id: 'sensor', name: 'Sensor', attributes: [
      { name: 'id', type: 'Long', isPrimaryKey: true },
      { name: 'lectura', type: 'Double', unico: true, minimo: 0.001, maximo: 0.025 },
    ],
  }]);
  const valores = [...codigo.matchAll(/\.setLectura\(([^)]+)d\)/g)].map(m => Number(m[1]));
  assert.equal(valores.length, 3);
  assert.equal(new Set(valores).size, valores.length);
  assert.ok(valores.every(valor => Number.isFinite(valor) && valor >= 0.001 && valor <= 0.025));
});

test('08: sin cuentas demo la cuenta inicial usa ADMIN de infraestructura', async () => {
  const auth = await leer('permisos', java('services/AuthService.java'));
  const preparar = metodo(auth, 'void preparar()');
  assert.match(preparar, /!cuentasDemo/);
  assert.match(preparar, /ROLES\.stream\(\)\.filter\(com\.example\.demo\.config\.Permisos\.ADMINISTRADORES::contains\)/);
  assert.match(preparar, /crearCuenta\(correoInicial, claveInicial, gestor,/);
});
