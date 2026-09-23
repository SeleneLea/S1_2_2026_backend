import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { cargarCasos, cargarGeneradores } from './generar-local.mjs';
import DiagramParser from '../../src/generators/DiagramParser.js';
import ServiceGenerator from '../../src/generators/ServiceGenerator.js';
import { extraerPermisos, permisosDe } from '../../src/generators/Permisos.js';

let controller, fixture, parsed;
const entidad = (id, name, attributes = [], extra = {}) => ({
  id, name, attributes: [{ name: 'id', type: 'Long', isPrimaryKey: true }, ...attributes], methods: [], ...extra,
});
const fk = (name, referencedEntity) => ({ name, type: 'Long', isForeignKey: true, referencedEntity, referencedField: 'id' });
const esErrorPermisos = error => error.code === 'PERMISOS_INVALIDOS' && error.message.startsWith('Permisos:');

before(async () => {
  ({ controller } = await cargarGeneradores());
  [fixture] = await cargarCasos(['permisos']);
  const convertido = controller.convertirFrontendADiagramParser(fixture.diagrama.nodes, fixture.diagrama.edges);
  parsed = new DiagramParser().parse(JSON.stringify(convertido));
});

test('08: la clase Permisos es metadata, conserva reglas y no muta el diagrama', () => {
  const original = JSON.stringify(fixture.diagrama);
  const extraido = extraerPermisos(fixture.diagrama.nodes, fixture.diagrama.edges);
  assert.equal(extraido.elementos.length, 5);
  assert.equal(extraido.permisosCrudos.length, 8);
  assert.equal(JSON.stringify(fixture.diagrama), original);
  assert.equal(parsed.entities.length, 5);
  assert.ok(parsed.entities.every(e => e.name !== 'Permisos'));
  assert.deepEqual(parsed.permisosCrudos, extraido.permisosCrudos);
  assert.throws(() => extraerPermisos(fixture.diagrama.nodes, fixture.diagrama.edges, []), esErrorPermisos);
  const soloJSON = controller.convertirFrontendADiagramParser(extraido.elementos, extraido.conexiones, ['CLIENTE: Cliente ver propios']);
  assert.deepEqual(new DiagramParser().parse(JSON.stringify(soloJSON)).permisosCrudos, ['CLIENTE: Cliente ver propios']);
});

test('08: resuelve pertenencia profunda y navegación inversa con PK textual', () => {
  const politica = permisosDe(parsed.entities, parsed.relationships, parsed.permisosCrudos);
  assert.equal(politica.explicito, true);
  assert.deepEqual(politica.porRol.CLIENTE.Plan, {
    acciones: ['ver'], alcance: 'propios', camino: ['objetivo', 'notaVenta', 'cliente'],
    entidadTitular: 'Cliente', campoId: 'id', tipoId: 'String',
  });
  assert.deepEqual(politica.porRol.ENTRENADOR.Cliente.camino, ['notaVentas', 'entrenador']);
  assert.deepEqual(politica.porRol.CLIENTE.Entrenador.acciones, []);
  assert.deepEqual(politica.porRol.ADMIN.Plan.acciones, ['ver', 'crear', 'editar', 'borrar']);
  assert.ok(politica.roles.some(rol => rol.rol === 'ADMIN' && rol.administrador));
  assert.equal(politica.roles.find(rol => rol.rol === 'CLIENTE').gestor, false);
});

test('08: ausencia de política mantiene compatibilidad; una política vacía cierra el negocio', () => {
  const legacy = permisosDe(parsed.entities, parsed.relationships, null);
  const cerrada = permisosDe(parsed.entities, parsed.relationships, []);
  assert.equal(legacy.explicito, false);
  assert.deepEqual(legacy.porRol.CLIENTE.Plan.acciones, ['ver']);
  assert.equal(legacy.porRol.CLIENTE.Plan.alcance, 'todos');
  assert.equal(cerrada.explicito, true);
  assert.deepEqual(cerrada.porRol.CLIENTE.Plan.acciones, []);
  assert.deepEqual(cerrada.porRol.ENTRENADOR.Plan.acciones, []);
  assert.deepEqual(cerrada.porRol.ADMIN.Plan.acciones, ['ver', 'crear', 'editar', 'borrar']);
  const sinGestores = permisosDe([entidad('cliente', 'Cliente')], [], null);
  assert.equal(sinGestores.roles.find(r => r.rol === 'CLIENTE').gestor, false);
  assert.ok(sinGestores.roles.some(r => r.rol === 'ADMIN' && r.administrador));
});

test('08: rechaza reglas desconocidas, duplicadas y restricciones del ADMIN reservado', () => {
  for (const regla of [
    'DESCONOCIDO: Plan ver todos', 'CLIENTE: ModuloInexistente ver todos',
    'CLIENTE: Plan publicar todos', 'CLIENTE: Plan ver propias',
    'CLIENTE: Plan todo,ver propios', 'ADMIN: Plan ver todos',
  ]) assert.throws(() => permisosDe(parsed.entities, parsed.relationships, [regla]), esErrorPermisos, regla);
  assert.throws(() => permisosDe(parsed.entities, parsed.relationships, [
    'CLIENTE: Plan ver propios', 'CLIENTE: Plan editar propios',
  ]), esErrorPermisos);
});

test('08: sin camino falla; caminos ambiguos exigen selección explícita validada', () => {
  const cliente = entidad('cliente', 'Cliente');
  assert.throws(() => permisosDe([cliente, entidad('plan', 'Plan')], [], ['CLIENTE: Plan ver propios']),
    error => esErrorPermisos(error) && error.message.includes('no hay relación'));
  const plan = entidad('plan', 'Plan', [fk('origen', 'Cliente'), fk('destino', 'Cliente')]);
  assert.throws(() => permisosDe([cliente, plan], [], ['CLIENTE: Plan ver propios']),
    error => esErrorPermisos(error) && error.message.includes('ambiguo'));
  const regla = { rol: 'CLIENTE', modulo: 'Plan', acciones: ['ver'], alcance: 'propios', camino: ['origen'] };
  assert.deepEqual(permisosDe([cliente, plan], [], [regla]).porRol.CLIENTE.Plan.camino, ['origen']);
  assert.throws(() => permisosDe([cliente, plan], [], [{ ...regla, camino: ['inexistente'] }]), esErrorPermisos);
});

test('08: resuelve M:N e identifica FK y clave primaria heredadas', () => {
  const cliente = entidad('cliente', 'Cliente');
  const plan = entidad('plan', 'Plan');
  const varios = [{ id: 'mn', type: 'many-to-many-direct', source: 'plan', target: 'cliente', sourceMultiplicity: '*', targetMultiplicity: '*' }];
  assert.deepEqual(permisosDe([cliente, plan], varios, ['CLIENTE: Plan ver propios']).porRol.CLIENTE.Plan.camino, ['clientes']);
  const base = entidad('base', 'BasePlan', [fk('cliente', 'Cliente')], { isAbstract: true, stereotype: 'abstract' });
  const persona = entidad('persona', 'Persona', [], { attributes: [{ name: 'codigo', type: 'String', isPrimaryKey: true }], isAbstract: true, stereotype: 'abstract' });
  const heredado = { ...cliente, attributes: [] };
  const herencias = [
    { id: 'plan-base', type: 'inheritance', source: 'plan', target: 'base', sourceMultiplicity: '*', targetMultiplicity: '1' },
    { id: 'cliente-persona', type: 'inheritance', source: 'cliente', target: 'persona', sourceMultiplicity: '*', targetMultiplicity: '1' },
  ];
  const resultado = permisosDe([heredado, plan, base, persona], herencias, ['CLIENTE: Plan ver propios']).porRol.CLIENTE.Plan;
  assert.deepEqual(resultado.camino, ['cliente']);
  assert.equal(resultado.campoId, 'codigo');
  assert.equal(resultado.tipoId, 'String');
});

test('08: un atributo o FK autorizacion no oculta el control de alcance en búsquedas', () => {
  const cliente = entidad('cliente', 'Cliente');
  const registro = entidad('registro', 'Registro', [{ name: 'autorizacion', type: 'String' }]);
  const ficha = entidad('ficha', 'Ficha', [fk('autorizacion', 'Autorizacion')]);
  const entidades = [cliente, registro, ficha, entidad('autorizacion', 'Autorizacion')];
  const politica = permisosDe(entidades, [], ['CLIENTE: Registro ver todos', 'CLIENTE: Ficha ver todos']);
  const generador = new ServiceGenerator(entidades, [], null, politica);
  for (const [modelo, metodos] of [
    [registro, ['findByAutorizacion', 'existsByAutorizacion']],
    [ficha, ['findByAutorizacion', 'findByAutorizacionId', 'countByAutorizacion']],
  ]) {
    const codigo = generador.generateCustomSearchImplementations(modelo);
    for (const nombre of metodos) {
      const cuerpo = codigo.match(new RegExp(`\\b${nombre}\\([^)]*\\)\\s*\\{([^}]+)\\}`))?.[1];
      assert.ok(cuerpo, `Falta ${modelo.name}.${nombre}`);
      assert.ok(cuerpo.includes(`this.autorizacion.<${modelo.name}>alcance`),
        `${modelo.name}.${nombre} debe usar el campo del servicio, no su argumento`);
    }
  }
});
