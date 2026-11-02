import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { generarCaso, nuevaCorrida } from './generar-local.mjs';
import { rutaDe, ajustarRutasPropias } from '../../src/generators/NombresReservados.js';

// Diagrama que salió de un backend existente: cada clase trae la ruta real de su controlador (rutaApi)
const clase = (id, nombre, atributos, rutaApi) => ({
  id, type: 'classNode', position: { x: 0, y: 0 },
  data: { className: nombre, attributes: atributos, methods: [], ...(rutaApi !== undefined ? { rutaApi } : {}) },
});
const diagrama = {
  nodes: [
    clase('cliente', 'Cliente', ['id: Long', 'nombre: String'], 'clientes'),
    clase('pedido', 'Pedido', ['id: Long', 'total: Double'], '/v1/pedidos/'),
    // Copiada del Cliente: trae su misma ruta, que ya está ocupada
    clase('copia', 'Copia', ['id: Long', 'nombre: String'], 'clientes'),
    // La de la cuenta de acceso es de la infraestructura del proyecto generado
    clase('sesion', 'Sesion', ['id: Long', 'inicio: String'], 'auth'),
    clase('producto', 'Producto', ['id: Long', 'nombre: String']),
  ],
  edges: [
    { id: 'r1', source: 'cliente', target: 'pedido', type: 'umlEdge', data: { type: 'Association', startLabel: '1', endLabel: '*' } },
  ],
};

let salida;
const leer = (tipo, relativa) => readFile(path.join(salida[tipo], relativa), 'utf8');
const controlador = nombre => leer('spring', `src/main/java/com/example/demo/controllers/${nombre}Controller.java`);
const dartDe = async (carpeta) => {
  const textos = [];
  for (const e of await readdir(carpeta, { withFileTypes: true })) {
    const ruta = path.join(carpeta, e.name);
    if (e.isDirectory()) textos.push(await dartDe(ruta));
    else if (e.name.endsWith('.dart')) textos.push(await readFile(ruta, 'utf8'));
  }
  return textos.join('\n');
};

before(async () => {
  const logOriginal = console.log;
  console.log = () => {};
  try {
    salida = await generarCaso({ tema: 'rutas-propias', titulo: 'Backend existente', diagrama }, await nuevaCorrida('rutas-propias'));
  } finally {
    console.log = logOriginal;
  }
});

test('rutaDe usa la ruta propia válida y, si no, la de la herramienta', () => {
  assert.equal(rutaDe({ name: 'Cliente', rutaApi: 'clientes' }), 'clientes');
  assert.equal(rutaDe({ name: 'Pedido', rutaApi: '/v1/pedidos/' }), 'v1/pedidos');
  assert.equal(rutaDe({ name: 'Pedido' }), 'pedido');
  assert.equal(rutaDe({ name: 'Pedido', rutaApi: '../x' }), 'pedido', 'sin segmentos raros');
  assert.equal(rutaDe({ name: 'Pedido', rutaApi: 'a//b' }), 'pedido');
  assert.equal(rutaDe({ name: 'Sesion', rutaApi: 'auth' }), 'sesion', 'la cuenta de acceso es de la infraestructura');
  assert.equal(rutaDe({ name: 'Auth' }), 'entidades/auth');
});

test('ajustarRutasPropias quita las repetidas y las que pisan la ruta de otra entidad', () => {
  const entidades = ajustarRutasPropias([
    { name: 'Cliente', rutaApi: 'clientes' },
    { name: 'Copia', rutaApi: 'Clientes' },
    { name: 'Otro', rutaApi: 'producto' },
    { name: 'Producto' },
    { name: 'Raro', rutaApi: 'con espacio' },
  ], [{ name: 'ClienteProducto' }]);
  assert.deepEqual(entidades.map(e => e.rutaApi), ['clientes', undefined, undefined, undefined, undefined]);
  assert.deepEqual(entidades.map(rutaDe), ['clientes', 'copia', 'otro', 'producto', 'raro']);
});

test('el backend generado atiende en las rutas del backend original', async () => {
  assert.match(await controlador('Cliente'), /@RequestMapping\("\/api\/clientes"\)/);
  assert.match(await controlador('Pedido'), /@RequestMapping\("\/api\/v1\/pedidos"\)/);
  assert.match(await controlador('Copia'), /@RequestMapping\("\/api\/copia"\)/, 'la copia no repite la ruta del Cliente');
  assert.match(await controlador('Sesion'), /@RequestMapping\("\/api\/sesion"\)/);
  assert.match(await controlador('Producto'), /@RequestMapping\("\/api\/producto"\)/);
});

test('la app Flutter llama a las mismas rutas y lee listas, el Page de Spring y el sobre paginado', async () => {
  const dart = await dartDe(path.join(salida.flutter, 'lib'));
  for (const ruta of ['clientes', 'v1/pedidos', 'copia', 'sesion', 'producto']) {
    assert.match(dart, new RegExp(`'/${ruta.replace('/', '\\/')}'`), `la app usa /${ruta}`);
  }
  assert.doesNotMatch(dart, /'\/cliente'/, 'no usa la ruta que habría armado la herramienta');
  assert.match(dart, /factory Pagina\.desde\(dynamic respuesta/);
  assert.match(dart, /if \(respuesta is List\)/);
  assert.match(dart, /mapa\['totalElements'\]/);
});
