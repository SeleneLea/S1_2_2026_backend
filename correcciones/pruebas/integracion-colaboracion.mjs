// Pruebas de la colaboración contra el servidor real y PostgreSQL (desde backend/, con el servidor
// levantado en el puerto 8083):
//   npm run pruebas:colaboracion            sin IA
//   npm run pruebas:colaboracion -- --con-ia   también "Pedir ajuste" con la IA real
// Usa las cuentas de prueba y crea sus propias salas (las borra al terminar).
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const raiz = process.cwd();
const requerir = createRequire(path.join(raiz, '../frontend/package.json'));
const { io } = requerir('socket.io-client');
const cargar = (rel) => import(pathToFileURL(path.join(raiz, rel)).href);
const { CLAVE_POR_DEFECTO, USUARIOS_PRUEBA } = await cargar('src/config/usuariosPrueba.js');
const repo = await cargar('src/colaboracion/repositorio.js');
const { firmaNodo } = await cargar('src/colaboracion/diagramaSemantico.js');
const { default: pool } = await cargar('src/config/db.js');
const BASE = process.env.URL_PRUEBAS || 'http://localhost:8083';
const CON_IA = process.argv.includes('--con-ia');
const clave = (process.env.CLAVE_USUARIOS_PRUEBA ?? CLAVE_POR_DEFECTO).trim();

const login = async (email) => {
    const r = await fetch(`${BASE}/apis/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: clave }) });
    return (await r.json()).data.token;
};
const api = async (token, metodo, ruta, cuerpo) => {
    const r = await fetch(`${BASE}${ruta}`, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { estado: r.status, json: await r.json().catch(() => null) };
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const evento = (s, nombre, filtro = () => true, ms = 15000) => new Promise((ok, mal) => {
    const t = setTimeout(() => { s.off(nombre, f); mal(new Error(`sin ${nombre}`)); }, ms);
    const f = (d) => { if (filtro(d)) { clearTimeout(t); s.off(nombre, f); ok(d); } };
    s.on(nombre, f);
});
/** Se une y devuelve también el estado inicial (con las tandas que el servidor ya tenía). */
const unirse = (token, salaId, { invitacion = null, lotes = [] } = {}) => new Promise((ok) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => {
        const inicial = evento(s, 'estadoInicial', () => true, 8000).catch(() => null);
        s.emit('unirseSala', { salaId, invitacion, lotes }, async (ack) => ok({ s, ack, inicial: ack?.ok ? await inicial : null }));
    });
});
const ack = (s, ev, d) => new Promise((r) => s.emit(ev, d, r));
const estadoEnBase = async (salaId) => JSON.parse((await pool.query('select xml from "Salas" where id=$1', [salaId])).rows[0].xml);
const estadoVivo = (s, salaId) => new Promise((ok) => { s.emit('solicitarEstado', { salaId }); s.once('estadoInicial', (d) => ok(d.state)); });

const [t1, t2] = await Promise.all(USUARIOS_PRUEBA.map((u) => login(u.email)));
const clase = (id, nombre, attrs, x = 0) => ({ id, type: 'classNode', position: { x, y: 0 }, data: { className: nombre, attributes: attrs, methods: [] } });
const inicial = { nodes: [clase('A', 'Cliente', ['id: Long']), clase('B', 'Venta', ['id: Long'], 350)], edges: [{ id: 'e1', source: 'A', target: 'B', type: 'umlEdge', data: { type: 'Association' } }] };
const salasCreadas = [];
const crear = async (titulo) => {
    const r = await api(t1, 'POST', '/apis/sala', { title: titulo, xml: JSON.stringify(inicial), description: 'prueba automática de colaboración' });
    const id = (r.json.data[0] || r.json.data).id;
    salasCreadas.push(id);
    return id;
};
const salaId = await crear('Prueba: permisos y sincronía');
const otraSala = await crear('Prueba: otra sala');
const paso = (texto) => console.log(`✔ ${texto}`);

try {
    // ── Permisos ──
    let r = await unirse(t2, salaId);
    assert.equal(r.ack.ok, false); assert.equal(r.ack.motivo, 'sin-acceso'); r.s.disconnect();
    assert.equal((await api(t2, 'GET', `/apis/sala/${salaId}`)).estado, 403);
    assert.equal((await api(t2, 'GET', `/apis/colaboracion/${salaId}/invitacion`)).estado, 403);
    r = await unirse(t2, salaId, { invitacion: 'invitacion-falsa' }); assert.equal(r.ack.ok, false); r.s.disconnect();
    const deOtra = (await api(t1, 'GET', `/apis/colaboracion/${otraSala}/invitacion`)).json.data.token;
    r = await unirse(t2, salaId, { invitacion: deOtra }); assert.equal(r.ack.ok, false); r.s.disconnect();
    assert.notEqual((await api(deOtra, 'GET', '/apis/colaboracion/salas')).estado, 200);
    const invitacion = (await api(t1, 'GET', `/apis/colaboracion/${salaId}/invitacion`)).json.data.token;
    const { s: s2, ack: a2 } = await unirse(t2, salaId, { invitacion });
    assert.equal(a2.ok, true);
    assert.equal((await api(t2, 'GET', `/apis/sala/${salaId}`)).estado, 200);
    paso('permisos: sin invitación válida no entra; con la del dueño sí; GET /sala exige acceso');

    // ── Borrados explícitos ──
    const { s: s1 } = await unirse(t1, salaId);
    const llega = evento(s1, 'operaciones');
    assert.equal((await ack(s2, 'operaciones', { salaId, lote: { id: 'prueba:1', ops: [{ op: 'quitarNodo', id: 'B' }] } })).ok, true);
    assert.deepEqual((await llega).ops.map((o) => o.op), ['quitarNodo']);
    await ack(s1, 'operaciones', { salaId, lote: { id: 'prueba:2', ops: [{ op: 'ponerNodo', nodo: clase('A', 'Cliente', ['id: Long', 'email: String']) }] } });
    let vivo = await estadoVivo(s2, salaId);
    assert.deepEqual(vivo.nodes.map((n) => n.id), ['A']);
    assert.equal(vivo.edges.length, 0);
    paso('borrado propagado como operación; la edición posterior no lo resucita');

    // ── Relación hacia una clase borrada: se descarta en el servidor ──
    await ack(s1, 'operaciones', { salaId, lote: { id: 'prueba:3', ops: [{ op: 'ponerArista', arista: { id: 'e9', source: 'A', target: 'B', type: 'umlEdge', data: {} } }] } });
    vivo = await estadoVivo(s1, salaId);
    assert.equal(vivo.edges.length, 0);
    paso('una relación hacia una clase que no existe no se crea');

    // ── Tandas con id: no se repiten ──
    const repetida = await ack(s1, 'operaciones', { salaId, lote: { id: 'prueba:2', ops: [{ op: 'ponerNodo', nodo: clase('A', 'Cliente', ['VIEJO']) }] } });
    assert.equal(repetida.duplicado, true);
    vivo = await estadoVivo(s1, salaId);
    assert.deepEqual(vivo.nodes.find((n) => n.id === 'A').data.attributes, ['id: Long', 'email: String']);
    paso('una tanda reenviada con el mismo id se descarta');

    // ── Persistencia al salir y tandas recordadas tras volver ──
    await ack(s1, 'operaciones', { salaId, lote: { id: 'prueba:4', ops: [{ op: 'ponerNodo', nodo: clase('C', 'Producto', ['id: Long'], 700) }] } });
    s1.disconnect(); s2.disconnect();
    await esperar(1500);
    assert.deepEqual((await estadoEnBase(salaId)).nodes.map((n) => n.id).sort(), ['A', 'C']);
    const vuelta = await unirse(t1, salaId, { lotes: ['prueba:4', 'prueba:99'] });
    assert.deepEqual(vuelta.inicial.aplicados, ['prueba:4']);
    vuelta.s.disconnect();
    paso('lo último antes de salir quedó en la base; al volver, el servidor dice qué tandas ya tenía');
    await esperar(800);

    // ── Dos propuestas distintas aceptadas a la vez, con la sala cerrada (nadie conectado) ──
    const base = await estadoEnBase(salaId);
    const nodoA = base.nodes.find((n) => n.id === 'A');
    const nodoC = base.nodes.find((n) => n.id === 'C');
    const pA = await repo.guardarPropuesta({
        salaId, pedidoPorNombre: 'Prueba', instruccion: 'telefono',
        operaciones: [{ op: 'modificarClase', id: 'A', antes: firmaNodo(nodoA), despues: { ...firmaNodo(nodoA), atributos: [...firmaNodo(nodoA).atributos, 'telefono: String'] } }],
        resumen: ['agregó a Cliente telefono'],
    });
    const pC = await repo.guardarPropuesta({
        salaId, pedidoPorNombre: 'Prueba', instruccion: 'precio',
        operaciones: [{ op: 'modificarClase', id: 'C', antes: firmaNodo(nodoC), despues: { ...firmaNodo(nodoC), atributos: [...firmaNodo(nodoC).atributos, 'precio: Double'] } }],
        resumen: ['agregó a Producto precio'],
    });
    const [rA, rC] = await Promise.all([
        api(t1, 'POST', `/apis/colaboracion/${salaId}/propuestas/${pA.id}`, { decision: 'aceptar' }),
        api(t1, 'POST', `/apis/colaboracion/${salaId}/propuestas/${pC.id}`, { decision: 'aceptar' }),
    ]);
    assert.equal(rA.estado, 200); assert.equal(rC.estado, 200);
    const tras = await estadoEnBase(salaId);
    assert.ok(tras.nodes.find((n) => n.id === 'A').data.attributes.includes('telefono: String'), 'quedó la propuesta A');
    assert.ok(tras.nodes.find((n) => n.id === 'C').data.attributes.includes('precio: Double'), 'quedó la propuesta C');
    assert.equal((await repo.obtenerPropuesta(pA.id)).estado, 'aceptada');
    assert.equal((await repo.obtenerPropuesta(pC.id)).estado, 'aceptada');
    paso('dos propuestas aceptadas a la vez con la sala cerrada: quedan las dos (ninguna pisa a la otra)');

    // ── Propuesta vieja: no borra trabajo nuevo ni anuncia lo que no aplicó ──
    const { s: s3 } = await unirse(t1, salaId);
    const { s: s4 } = await unirse(t2, salaId);
    const actual = await estadoVivo(s3, salaId);
    const nodoC2 = actual.nodes.find((n) => n.id === 'C');
    const pBorrar = await repo.guardarPropuesta({
        salaId, pedidoPorNombre: 'Prueba', instruccion: 'borrar Producto',
        operaciones: [{ op: 'eliminarClase', id: 'C', antes: firmaNodo(nodoC2) }], resumen: ['eliminó la clase Producto'],
    });
    // Alguien conecta una relación a Producto después de la propuesta
    await ack(s4, 'operaciones', { salaId, lote: { id: 'prueba:5', ops: [{ op: 'ponerArista', arista: { id: 'e5', source: 'A', target: 'C', type: 'umlEdge', data: { type: 'Association' } } }] } });
    const sistema = evento(s3, 'chat:nuevo', (m) => m.tipo === 'sistema');
    const d1 = await ack(s3, 'propuesta:decidir', { salaId, propuestaId: pBorrar.id, decision: 'aceptar' });
    assert.equal(d1.ok, false);
    assert.match((await sistema).texto, /No se cambió nada/);
    const sigue = await estadoVivo(s3, salaId);
    assert.ok(sigue.nodes.some((n) => n.id === 'C') && sigue.edges.some((e) => e.id === 'e5'), 'Producto y su relación nueva siguen');
    paso('una propuesta vieja no borra una clase con relaciones nuevas y avisa "No se cambió nada"');

    // ── Doble decisión de la misma propuesta: gana una ──
    const pDoble = await repo.guardarPropuesta({ salaId, pedidoPorNombre: 'Prueba', instruccion: 'x', operaciones: [], resumen: [] });
    const [x, y] = await Promise.all([
        ack(s3, 'propuesta:decidir', { salaId, propuestaId: pDoble.id, decision: 'aceptar' }),
        ack(s4, 'propuesta:decidir', { salaId, propuestaId: pDoble.id, decision: 'aceptar' }),
    ]);
    assert.equal([x.ok, y.ok].filter(Boolean).length, 1);
    paso('dos personas aceptan la misma propuesta a la vez: gana una');

    // ── Expulsar corta la conexión en vivo ──
    const fila = (await pool.query('select id from "Usersala" where salas_id = $1 and userid = (select id from "Users" where email = $2)', [salaId, USUARIOS_PRUEBA[1].email])).rows[0];
    const revocado = evento(s4, 'accesoRevocado');
    assert.equal((await api(t1, 'DELETE', `/apis/usersala/${fila.id}`)).estado, 200);
    await revocado;
    const intento = await ack(s4, 'operaciones', { salaId, lote: { id: 'prueba:6', ops: [{ op: 'quitarNodo', id: 'A' }] } });
    assert.equal(intento.ok, false);
    assert.ok((await estadoVivo(s3, salaId)).nodes.some((n) => n.id === 'A'), 'el expulsado no pudo borrar');
    paso('al quitar a un integrante se corta su socket y ya no puede mandar cambios');

    // ── Auditoría: un expulsado no vuelve con su invitación vieja; invitarlo por correo sí lo readmite ──
    const { s: s5, ack: a5 } = await unirse(t2, salaId, { invitacion });
    assert.equal(a5.ok, false);
    assert.equal(a5.motivo, 'expulsado');
    s5.disconnect();
    assert.equal((await api(t2, 'GET', `/apis/sala/${salaId}`)).estado, 403);
    assert.equal((await api(t1, 'POST', '/apis/usersala', { salas_id: salaId, email: USUARIOS_PRUEBA[1].email })).estado, 201);
    const { s: s6, ack: a6 } = await unirse(t2, salaId);
    assert.equal(a6.ok, true, 'readmitido por el dueño');
    s6.disconnect();
    paso('un expulsado no vuelve con su enlace viejo; si el dueño lo invita por correo, sí');

    // ── Auditoría: una tanda aplicada se reconoce aunque después lleguen miles de otras ──
    const idViejo = 'clienteprueba:1';
    assert.equal((await ack(s3, 'operaciones', { salaId, lote: { id: idViejo, ops: [{ op: 'ponerNodo', nodo: clase('A', 'Cliente', ['nombre viejo']) }] } })).ok, true);
    for (let i = 1; i <= 2001; i += 1) {
        await ack(s3, 'operaciones', { salaId, lote: { id: `otrocliente:${i}`, ops: [{ op: 'moverNodo', id: 'A', position: { x: i, y: 0 } }] } });
    }
    await ack(s3, 'operaciones', { salaId, lote: { id: 'otrocliente:2002', ops: [{ op: 'ponerNodo', nodo: clase('A', 'Cliente', ['trabajo actual']) }] } });
    const vuelve = await unirse(t1, salaId, { lotes: [idViejo] });
    assert.deepEqual(vuelve.inicial.aplicados, [idViejo], 'el servidor recuerda la tanda vieja');
    const reenvio = await ack(vuelve.s, 'operaciones', { salaId, lote: { id: idViejo, ops: [{ op: 'ponerNodo', nodo: clase('A', 'Cliente', ['nombre viejo']) }] } });
    assert.equal(reenvio.duplicado, true);
    assert.deepEqual((await estadoVivo(s3, salaId)).nodes.find((n) => n.id === 'A').data.attributes, ['trabajo actual']);
    vuelve.s.disconnect();
    paso('una tanda vieja reenviada después de 2001 tandas se reconoce y no pisa el trabajo actual');

    // ── Auditoría: una tanda de más de 2000 operaciones se rechaza entera (no se recorta) ──
    const antesGrande = (await estadoVivo(s3, salaId)).nodes.length;
    const grande = await ack(s3, 'operaciones', { salaId, lote: { id: 'clienteprueba:2', ops: Array.from({ length: 2001 }, (_, i) => ({ op: 'ponerNodo', nodo: clase(`G${i}`, 'G', []) })) } });
    assert.equal(grande.ok, false);
    assert.equal(grande.demasiadas, true);
    assert.equal((await estadoVivo(s3, salaId)).nodes.length, antesGrande, 'no se aplicó nada');
    paso('una tanda de 2001 operaciones se rechaza entera');

    // ── Auditoría: el chat se reanuda desde el último mensaje conocido ──
    const ultimo = (await ack(s3, 'chat:enviar', { salaId, texto: 'mensaje para reanudar' })).mensaje.id;
    await ack(s3, 'chat:enviar', { salaId, texto: 'mensaje posterior' });
    const reanudado = await ack(s3, 'chat:historial', { salaId, despuesDe: ultimo });
    assert.equal(reanudado.reanudacion, true);
    assert.equal(reanudado.completo, true);
    assert.deepEqual(reanudado.mensajes.map((m) => m.texto).filter((x) => x === 'mensaje posterior'), ['mensaje posterior']);
    assert.ok(reanudado.mensajes.every((m) => m.id > ultimo));
    paso('el chat se reanuda con lo posterior al último mensaje conocido');

    // ── Verificación 15/10 (V4): al reanudar llegan también los mensajes conocidos que cambiaron ──
    const marca = (await ack(s3, 'chat:historial', { salaId })).marca;
    const mensajeIA = (await ack(s3, 'chat:enviar', { salaId, texto: 'mensaje que después se completa' })).mensaje;
    const posterior = (await ack(s3, 'chat:enviar', { salaId, texto: 'otro posterior' })).mensaje;
    await repo.actualizarDatosMensaje(mensajeIA.id, { propuesta: { id: 4242, estado: 'pendiente' } });
    const conCambios = await ack(s3, 'chat:historial', { salaId, despuesDe: posterior.id, actualizadosDesde: marca });
    const completado = conCambios.mensajes.find((m) => m.id === mensajeIA.id);
    assert.ok(completado, 'el mensaje anterior al cursor vuelve porque cambió');
    assert.equal(completado.datos.propuesta.id, 4242);
    const sinMarca = await ack(s3, 'chat:historial', { salaId, despuesDe: posterior.id });
    assert.ok(!sinMarca.mensajes.some((m) => m.id === mensajeIA.id), 'sin marca, solo lo posterior');
    paso('al reanudar el chat llegan los mensajes conocidos que se completaron mientras tanto');

    // ── Verificación 15/10 (V1): un cambio humano con autoguardado pendiente y una propuesta aceptada quedan los dos ──
    await ack(s3, 'operaciones', { salaId, lote: { id: 'clienteprueba:3', ops: [{ op: 'ponerNodo', nodo: clase('H', 'Humano', ['id: Long'], 900) }] } });
    const enVivo = await estadoVivo(s3, salaId);
    const nodoAvivo = enVivo.nodes.find((n) => n.id === 'A');
    const pIA = await repo.guardarPropuesta({
        salaId, pedidoPorNombre: 'Prueba', instruccion: 'rut',
        operaciones: [{ op: 'modificarClase', id: 'A', antes: firmaNodo(nodoAvivo), despues: { ...firmaNodo(nodoAvivo), atributos: [...firmaNodo(nodoAvivo).atributos, 'rut: String'] } }],
        resumen: ['agregó a Cliente rut'],
    });
    assert.equal((await ack(s3, 'propuesta:decidir', { salaId, propuestaId: pIA.id, decision: 'aceptar' })).ok, true);
    await esperar(4000); // pasa el autoguardado programado por el cambio humano (3 s)
    const guardadoFinal = await estadoEnBase(salaId);
    assert.ok(guardadoFinal.nodes.some((n) => n.id === 'H'), 'quedó el cambio humano');
    assert.ok(guardadoFinal.nodes.find((n) => n.id === 'A').data.attributes.includes('rut: String'), 'quedó la propuesta');
    assert.ok(Number((await pool.query('select version_guardada from "Salas" where id=$1', [salaId])).rows[0].version_guardada) > 0);
    paso('cambio humano + propuesta aceptada: la base conserva los dos (versión guardada creciente)');

    // ── Verificación 15/10 (V2): una tanda de la versión anterior que la base ya tenía se reconoce al entrar ──
    await pool.query(`update "Salas" set lotes_aplicados = $2::jsonb where id = $1`, [otraSala, JSON.stringify({ secuencias: {}, lotes: ['tanda-legada-1'] })]);
    const legado = await unirse(t1, otraSala, { lotes: ['tanda-legada-1', 'tanda-legada-2'] });
    assert.deepEqual(legado.inicial.aplicados, ['tanda-legada-1'], 'la aplicada se informa; la desconocida no');
    legado.s.disconnect();
    paso('una tanda sin numerar que la base ya tenía se informa como aplicada al entrar');

    // ── Dos chats por sala: el del equipo y el de la IA se guardan y se paginan por separado ──
    const deEquipo = (await ack(s3, 'chat:enviar', { salaId, texto: 'solo para el equipo' })).mensaje;
    assert.equal(deEquipo.canal, 'equipo');
    const paraLaIA = await repo.guardarMensaje({ salaId, autorId: null, autorNombre: 'Prueba', tipo: 'usuario', texto: 'pedido guardado', datos: { paraIA: true } });
    assert.equal(paraLaIA.canal, 'ia');
    assert.equal((await repo.guardarMensaje({ salaId, tipo: 'ia', texto: 'respuesta' })).canal, 'ia');
    const inicio = await ack(s3, 'chat:historial', { salaId });
    assert.equal(typeof inicio.hayAnteriores, 'object');
    assert.ok(inicio.mensajes.some((m) => m.id === deEquipo.id) && inicio.mensajes.some((m) => m.id === paraLaIA.id));
    const viejosIA = await ack(s3, 'chat:anteriores', { salaId, canal: 'ia', antesDe: paraLaIA.id + 100 });
    assert.ok(viejosIA.mensajes.length > 0 && viejosIA.mensajes.every((m) => m.canal === 'ia'));
    const viejosEquipo = await ack(s3, 'chat:anteriores', { salaId, canal: 'equipo', antesDe: deEquipo.id + 100 });
    assert.ok(viejosEquipo.mensajes.some((m) => m.id === deEquipo.id) && viejosEquipo.mensajes.every((m) => m.canal === 'equipo'));
    paso('chat del equipo y chat de la IA: cada mensaje con su canal y cada uno se pagina aparte');

    // ── Sin conexión: lo escrito y lo que hizo la IA local se comparte al volver, una sola vez ──
    const otroVe = evento(s3, 'chat:nuevo', (m) => m.idLocal === 'sc-prueba-2');
    const offline = [
      { idLocal: 'sc-prueba-1', canal: 'equipo', tipo: 'usuario', texto: 'avancé sin internet', escritoEn: '2026-10-25T10:00:00.000Z' },
      { idLocal: 'sc-prueba-2', canal: 'ia', tipo: 'usuario', texto: 'agrega la clase Sucursal', escritoEn: '2026-10-25T10:01:00.000Z', datos: { paraIA: true } },
      { idLocal: 'sc-prueba-3', canal: 'ia', tipo: 'ia', texto: '💻 Hecho con la IA local: agregó Sucursal', escritoEn: '2099-01-01T00:00:00.000Z', datos: { motor: 'interprete', cambios: 1 } },
      { idLocal: 'id inválido!', canal: 'equipo', tipo: 'usuario', texto: 'se descarta' },
    ];
    const subida = await ack(s3, 'chat:importar', { salaId, mensajes: offline });
    assert.equal(subida.ok, true);
    assert.deepEqual(subida.aceptados, ['sc-prueba-1', 'sc-prueba-2', 'sc-prueba-3']);
    assert.equal(subida.guardados, 3);
    await otroVe;
    const reenvioOffline = await ack(s3, 'chat:importar', { salaId, mensajes: offline.slice(0, 3) });
    assert.deepEqual(reenvioOffline.aceptados, ['sc-prueba-1', 'sc-prueba-2', 'sc-prueba-3'], 'reenviar no falla');
    assert.equal(reenvioOffline.guardados, 0, 'y no duplica');
    const filasOffline = (await pool.query(
        `select id_local, tipo, canal, autor_nombre, datos from "MensajesSala" where sala_id = $1 and id_local like 'sc-prueba-%' order by id`, [salaId])).rows;
    assert.deepEqual(filasOffline.map((f) => [f.id_local, f.canal]), [['sc-prueba-1', 'equipo'], ['sc-prueba-2', 'ia'], ['sc-prueba-3', 'ia']]);
    assert.equal(filasOffline[2].autor_nombre, 'IA local');
    assert.equal(filasOffline[2].datos.sinConexion, true);
    assert.equal(filasOffline[2].datos.pedidoPor, USUARIOS_PRUEBA[0].name);
    assert.ok(Date.parse(filasOffline[2].datos.escritoEn) <= Date.now(), 'una fecha futura no desordena el chat');
    paso('lo escrito sin conexión (equipo, pedido y respuesta de la IA local) se comparte una sola vez');

    // ── Los cambios que hizo la IA local quedan en el historial como de la IA, pedidos por quien la usó ──
    assert.equal((await ack(s3, 'operaciones', { salaId, lote: { id: 'clienteprueba:4', origen: 'ia-local', ops: [{ op: 'ponerNodo', nodo: clase('S', 'Sucursal', ['id: Long'], 1200) }] } })).ok, true);
    await esperar(3500); // el historial agrupa ráfagas de 2,5 s
    const cambioLocal = (await pool.query(
        `select es_ia, autor_nombre, pedido_por from "CambiosSala" where sala_id = $1 and elemento_id = 'S' order by id desc limit 1`, [salaId])).rows[0];
    assert.ok(cambioLocal, 'quedó en el historial');
    assert.equal(cambioLocal.es_ia, true);
    assert.equal(cambioLocal.autor_nombre, 'IA local');
    assert.equal(cambioLocal.pedido_por, USUARIOS_PRUEBA[0].name);
    paso('los cambios de la IA local quedan en "Quién hizo qué" como de la IA (pedido por quien la usó)');

    // ── Código -> diagrama: las diferencias con un proyecto importado quedan como propuesta ──
    const antesCodigo = await estadoVivo(s3, salaId);
    const clienteNodo = antesCodigo.nodes.find((n) => n.id === 'A');
    // Mientras tanto, alguien agrega una clase que el código no conoce: la propuesta no debe borrarla
    await ack(s3, 'operaciones', { salaId, lote: { id: 'clienteprueba:5', ops: [{ op: 'ponerNodo', nodo: clase('Z', 'Ajena', ['id: Long'], 1500) }] } });
    const desdeCodigo = await ack(s3, 'codigo:proponer', {
        salaId,
        origen: { archivo: 'backend.zip', entidades: 2 },
        cambios: {
            nodos: [
                { ...clienteNodo, data: { ...clienteNodo.data, attributes: [...clienteNodo.data.attributes, 'correo: String {unico}'] } },
                { id: 'codigo-proveedor', type: 'classNode', position: { x: 0, y: 0 }, data: { className: 'Proveedor', attributes: ['id: Long', 'nombre: String'], methods: [] } },
            ],
            aristas: [{ id: 'codigo-rel-1', source: 'codigo-proveedor', target: 'A', type: 'umlEdge', data: { type: 'Association', startLabel: '1', endLabel: '*' } }],
            quitarNodos: [], quitarAristas: [],
        },
    });
    assert.equal(desdeCodigo.ok, true, desdeCodigo.mensaje);
    assert.equal(desdeCodigo.cantidad, 3, 'modificar Cliente, agregar Proveedor y su relación');
    const propCodigo = await repo.obtenerPropuesta(desdeCodigo.propuestaId);
    assert.equal(propCodigo.estado, 'pendiente');
    assert.deepEqual(propCodigo.operaciones.map((o) => o.op).sort(), ['agregarClase', 'agregarRelacion', 'modificarClase']);
    assert.ok(!propCodigo.operaciones.some((o) => o.op === 'eliminarClase'), 'la clase agregada mientras tanto no se borra');
    assert.ok((await estadoVivo(s3, salaId)).nodes.some((n) => n.id === 'Z'));
    const sinDiferencias = await ack(s3, 'codigo:proponer', { salaId, origen: { archivo: 'igual.zip' }, cambios: { nodos: [], aristas: [] } });
    assert.equal(sinDiferencias.sinCambios, true);
    const malo = await ack(s3, 'codigo:proponer', { salaId, cambios: { nodos: [{ id: '../x', type: 'classNode', data: { className: 'X' } }], aristas: [{ id: 'r', source: 'A', target: 'noexiste', data: { type: 'Association' } }] } });
    assert.equal(malo.sinCambios, true, 'lo inválido se descarta');
    paso('código -> diagrama: las diferencias quedan como propuesta y no borran lo que otro agregó mientras tanto');

    // ── "Pedir ajuste" reemplaza la propuesta anterior (IA real) ──
    if (CON_IA) {
        const propuesta1 = evento(s3, 'propuesta:nueva', () => true, 120000);
        await ack(s3, 'chat:enviar', { salaId, texto: '@IA agrega la clase Factura con numero y fecha relacionada con Cliente' });
        const p1 = await propuesta1;
        const propuesta2 = evento(s3, 'propuesta:nueva', () => true, 120000);
        const reemplazo = evento(s3, 'propuesta:actualizada', (p) => p.id === p1.id, 120000);
        await ack(s3, 'chat:enviar', { salaId, texto: 'que además tenga el atributo total de tipo Double', ajusta: p1.id });
        await propuesta2;
        assert.equal((await reemplazo).estado, 'reemplazada');
        paso('"Pedir ajuste" reemplaza la propuesta anterior');
    }
    s3.disconnect(); s4.disconnect();
    console.log('OK: todas las pruebas de colaboración pasaron');
} finally {
    for (const id of salasCreadas) await api(t1, 'DELETE', `/apis/sala/${id}`);
    await pool.end();
}
process.exit(0);
