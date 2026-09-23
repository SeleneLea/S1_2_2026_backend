import assert from 'node:assert/strict';

/** M:N inversa editable sin acceso de escritura a la entidad propietaria. */
export async function comprobarPermisosMN({ api }) {
    const crear = async (ruta, body, token) => {
        const r = await api(ruta, 'POST', body, token);
        assert.equal(r.estado, 201, `${ruta}: ${r.message || "Operación rechazada"}`);
        return r.data;
    };
    const clienteA = await crear('/cliente', { id: 'CLI-MN-A', nombre: 'Cliente MNA', correo: 'mna@example.test' });
    const clienteB = await crear('/cliente', { id: 'CLI-MN-B', nombre: 'Cliente MNB', correo: 'mnb@example.test' });
    const entrenadorA = await crear('/entrenador', { id: 'ENT-MN-A', nombre: 'Entrenador MNA', correo: 'emna@example.test' });
    const entrenadorB = await crear('/entrenador', { id: 'ENT-MN-B', nombre: 'Entrenador MNB', correo: 'emnb@example.test' });
    const nota = async (cliente, entrenador) => crear('/nota-venta', { descripcion: 'Nota MN', fecha: '2026-09-22', clienteId: cliente.id, entrenadorId: entrenador.id });
    const notaA = await nota(clienteA, entrenadorA), notaB = await nota(clienteB, entrenadorB);
    const oa = await crear('/objetivo', { nombre: 'Objetivo A conserva escalares', notaVentaId: notaA.id });
    const oa2 = await crear('/objetivo', { nombre: 'Objetivo A2', notaVentaId: notaA.id });
    const ob = await crear('/objetivo', { nombre: 'Objetivo B ajeno', notaVentaId: notaB.id });
    await crear('/cuentas', { correo: 'entrenador-mna@example.test', clave: '12345678', rol: 'ENTRENADOR', referenciaId: entrenadorA.id, nombre: 'Entrenador MNA' });
    const login = await api('/auth/login', 'POST', { correo: 'entrenador-mna@example.test', clave: '12345678' });
    assert.equal(login.estado, 200);
    const token = login.data.token;
    const entrenador = (ruta, method='GET', body) => api(ruta, method, body, token);
    const objetivo = async id => (await api(`/objetivo/${id}`)).data;
    const creado = await crear('/plan', { nombre: 'Plan inverso', semanas: 8, objetivoIds: [oa.id] }, token);
    assert.deepEqual(creado.objetivoIds, [oa.id]);
    assert.ok((await objetivo(oa.id)).planIds.includes(creado.id), 'POST persiste el lado propietario');
    assert.equal((await entrenador(`/plan/${creado.id}`)).estado, 200);
    assert.equal((await entrenador(`/plan/${creado.id}`, 'PATCH', { objetivoIds: [oa.id, oa2.id] })).estado, 200);
    assert.ok((await objetivo(oa2.id)).planIds.includes(creado.id), 'PATCH agrega la asociación propietaria');
    assert.equal((await entrenador(`/plan/${creado.id}`, 'PATCH', { nombre: 'Nombre autorizado' })).estado, 200);
    assert.deepEqual((await entrenador(`/plan/${creado.id}`)).data.objetivoIds.sort(), [oa.id, oa2.id].sort(), 'PATCH omisión conserva enlaces');
    assert.equal((await entrenador(`/plan/${creado.id}`, 'PATCH', { nombre: 'No persistir', objetivoIds: [ob.id] })).estado, 403);
    const intacto = (await api(`/plan/${creado.id}`)).data;
    assert.equal(intacto.nombre, 'Nombre autorizado', 'Denegación revierte campos escalares');
    assert.deepEqual(intacto.objetivoIds.sort(), [oa.id, oa2.id].sort(), 'Denegación revierte enlaces');
    assert.ok(!(await objetivo(ob.id)).planIds.includes(creado.id));
    const totalAntes = (await api('/plan/count')).total;
    assert.equal((await entrenador('/plan', 'POST', { nombre: 'Mixto denegado', semanas: 4, objetivoIds: [oa.id, ob.id] })).estado, 403);
    assert.equal((await api('/plan/count')).total, totalAntes, 'POST denegado no deja Plan huérfano');
    const listado = await entrenador('/plan?pagina=0&tamano=50');
    assert.equal(listado.estado, 200);
    assert.equal(listado.total, 1, 'JOIN con dos objetivos no duplica total');
    assert.deepEqual(listado.data.map(p=>p.id), [creado.id]);
    assert.equal((await entrenador(`/plan/${creado.id}`, 'PATCH', { objetivoIds: [oa2.id] })).estado, 200);
    assert.ok(!(await objetivo(oa.id)).planIds.includes(creado.id), 'PATCH quita la asociación propietaria');
    assert.ok((await objetivo(oa2.id)).planIds.includes(creado.id));
    assert.equal((await objetivo(oa.id)).nombre, oa.nombre, 'Sincronizar no edita escalares del owner');
    assert.equal((await entrenador(`/plan/${creado.id}`, 'DELETE')).estado, 200);
    assert.ok(!(await objetivo(oa2.id)).planIds.includes(creado.id), 'DELETE limpia tabla intermedia');
    assert.equal((await api(`/plan/${creado.id}`)).estado, 404);
    const compartido = await crear('/plan', { nombre: 'Compartido', semanas: 5, objetivoIds: [oa.id, ob.id] });
    assert.equal((await entrenador(`/plan/${compartido.id}`)).estado, 200);
    assert.equal((await entrenador(`/plan/${compartido.id}`, 'PATCH', { nombre: 'Prohibido' })).estado, 403);
    assert.equal((await entrenador(`/plan/${compartido.id}`, 'DELETE')).estado, 403);
    assert.equal((await api(`/plan/${compartido.id}`)).data.nombre, 'Compartido');
    console.log('OK M:N inversa: 29 aserciones create, PATCH, propietario, rollback, lectura compartida, escritura compartida denegada y DELETE');
}
