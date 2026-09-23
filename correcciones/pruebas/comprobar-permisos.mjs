import assert from 'node:assert/strict';

/** Prueba 08 exclusivamente en la base nueva del harness, nunca en el diagramador. */
export async function comprobarPermisos({ api, pg, configuracion, base }) {
  const crear = async (ruta, datos) => {
    const respuesta = await api(ruta, 'POST', datos);
    assert.equal(respuesta.estado, 201, `Preparar ${ruta}: ${respuesta.message}`);
    return respuesta.data;
  };
  const login = async correo => {
    const respuesta = await api('/auth/login', 'POST', { correo, clave: '12345678' });
    assert.equal(respuesta.estado, 200, 'Inicio de sesión de prueba');
    return respuesta.data.token;
  };
  const sesion = credencial => (ruta, metodo = 'GET', datos) => api(ruta, metodo, datos, credencial);
  const altaCuenta = async (correo, rol, referenciaId) => crear('/cuentas', {
    correo, clave: '12345678', rol, referenciaId, nombre: 'Cuenta de prueba de alcance',
  });
  const ids = respuesta => (respuesta.data || []).map(registro => registro.id).sort();
  const listaPropia = async (pedir, ruta, esperados) => {
    const respuesta = await pedir(ruta);
    assert.equal(respuesta.estado, 200, `Listado permitido ${ruta}`);
    assert.deepEqual(ids(respuesta), [...esperados].sort(), `Alcance del listado ${ruta}`);
    const paginada = await pedir(`${ruta}?pagina=0&tamano=1`);
    assert.equal(paginada.estado, 200);
    assert.equal(paginada.total, esperados.length, `El total de ${ruta} no filtra datos ajenos`);
    const cuenta = await pedir(`${ruta}/count`);
    assert.equal(cuenta.estado, 200);
    assert.equal(cuenta.total, esperados.length, `Count de ${ruta} respeta el alcance`);
  };
  const noExisteAjeno = async (pedir, ruta, id) => {
    const respuesta = await pedir(`${ruta}/exists/${id}`);
    assert.ok(respuesta.estado === 403 || (respuesta.estado === 200 && respuesta.exists === false),
      `exists de ${ruta} no debe revelar la existencia de un registro ajeno`);
  };

  // Dos cadenas independientes, además de lo sembrado, con identidades inequívocas.
  const clienteA = await crear('/cliente', { id: 'CLI-PRUEBA-A', nombre: 'Cliente A', correo: 'cliente-a@dominio.test' });
  const clienteB = await crear('/cliente', { id: 'CLI-PRUEBA-B', nombre: 'Cliente B', correo: 'cliente-b@dominio.test' });
  const entrenadorA = await crear('/entrenador', { id: 'ENT-PRUEBA-A', nombre: 'Entrenador A', correo: 'entrenador-a@dominio.test' });
  const entrenadorB = await crear('/entrenador', { id: 'ENT-PRUEBA-B', nombre: 'Entrenador B', correo: 'entrenador-b@dominio.test' });
  const cadena = async (sufijo, cliente, entrenador) => {
    const nota = await crear('/nota-venta', { descripcion: `Venta ${sufijo}`, fecha: '2026-09-22', clienteId: cliente.id, entrenadorId: entrenador.id });
    const objetivo = await crear('/objetivo', { nombre: `Objetivo ${sufijo}`, notaVentaId: nota.id });
    const plan = await crear('/plan', { nombre: `Plan ${sufijo}`, semanas: 6, objetivoId: objetivo.id });
    return { nota, objetivo, plan };
  };
  const a = await cadena('A', clienteA, entrenadorA);
  const b = await cadena('B', clienteB, entrenadorB);
  await altaCuenta('cliente-a@prueba.test', 'CLIENTE', clienteA.id);
  await altaCuenta('cliente-b@prueba.test', 'CLIENTE', clienteB.id);
  await altaCuenta('entrenador-a@prueba.test', 'ENTRENADOR', entrenadorA.id);
  await altaCuenta('entrenador-b@prueba.test', 'ENTRENADOR', entrenadorB.id);
  const tokenClienteA = await login('cliente-a@prueba.test');
  const tokenEntrenadorA = await login('entrenador-a@prueba.test');
  const ca = sesion(tokenClienteA), cb = sesion(await login('cliente-b@prueba.test'));
  const ea = sesion(tokenEntrenadorA), eb = sesion(await login('entrenador-b@prueba.test'));

  // El prototipo debe arrancar con las cuentas demo realmente enlazadas.
  for (const [rol, ruta] of [['cliente', '/cliente'], ['entrenador', '/entrenador']]) {
    const demo = sesion(await login(`${rol}@demo.com`));
    const yo = await demo('/auth/yo');
    assert.equal(yo.estado, 200);
    assert.ok(yo.data.referenciaId, `La cuenta demo ${rol} está vinculada`);
    assert.equal((await demo(`${ruta}/${yo.data.referenciaId}`)).estado, 200);
  }

  for (const [pedir, cliente, rama] of [[ca, clienteA, a], [cb, clienteB, b]]) {
    await listaPropia(pedir, '/cliente', [cliente.id]);
    await listaPropia(pedir, '/objetivo', [rama.objetivo.id]);
    await listaPropia(pedir, '/plan', [rama.plan.id]);
    assert.equal((await pedir(`/plan/exists/${rama.plan.id}`)).exists, true);
    assert.equal((await pedir(`/plan/${rama.plan.id}/objetivo`)).data.id, rama.objetivo.id);
    for (const ruta of ['/entrenador', '/nota-venta', '/cuentas']) assert.equal((await pedir(ruta)).estado, 403, `Módulo ${ruta} no permitido al cliente`);
    for (const [metodo, cuerpo] of [['POST', { nombre: 'No autorizado', semanas: 6, objetivoId: rama.objetivo.id }], ['PUT', rama.plan], ['PATCH', { nombre: 'No autorizado' }], ['DELETE', undefined]]) {
      const ruta = metodo === 'POST' ? '/plan' : `/plan/${rama.plan.id}`;
      assert.equal((await pedir(ruta, metodo, cuerpo)).estado, 403, `Cliente no puede ${metodo}`);
    }
  }
  assert.equal((await ca(`/cliente/${clienteB.id}`)).estado, 403);
  assert.equal((await ca(`/plan/${b.plan.id}`)).estado, 403);
  assert.equal((await ca(`/plan/${b.plan.id}/objetivo`)).estado, 403, 'Navegación FK no permite saltar el alcance');
  await noExisteAjeno(ca, '/plan', b.plan.id);
  const manipulado = await ca(`/plan?objetivoId=${b.objetivo.id}&referenciaId=${clienteB.id}&alcance=todos&rol=ADMIN`);
  assert.equal(manipulado.estado, 200);
  assert.equal(manipulado.total, 0, 'Filtros del cliente no amplían el alcance de la sesión');

  for (const [pedir, cliente, rama, ajena] of [[ea, clienteA, a, b], [eb, clienteB, b, a]]) {
    await listaPropia(pedir, '/cliente', [cliente.id]);
    await listaPropia(pedir, '/plan', [rama.plan.id]);
    await listaPropia(pedir, '/nota-venta', [rama.nota.id]);
    assert.equal((await pedir(`/nota-venta/${rama.nota.id}`, 'DELETE')).estado, 403,
      'Aunque puede borrar NotaVenta, la cascada no puede borrar Objetivo sin permiso');
    assert.equal((await api(`/objetivo/${rama.objetivo.id}`)).estado, 200, 'El hijo rechazado por la cascada sigue existiendo');
    assert.equal((await api(`/plan/${rama.plan.id}`)).estado, 200, 'El nieto también permanece intacto');
    assert.equal((await pedir(`/plan/${rama.plan.id}`, 'PUT', { ...rama.plan, nombre: `Editado ${cliente.id}` })).estado, 200);
    assert.equal((await pedir(`/plan/${rama.plan.id}`, 'PATCH', { semanas: 8 })).estado, 200);
    assert.equal((await pedir(`/plan/${ajena.plan.id}`)).estado, 403);
    assert.equal((await pedir(`/plan/${ajena.plan.id}`, 'PUT', ajena.plan)).estado, 403);
    assert.equal((await pedir(`/plan/${ajena.plan.id}`, 'DELETE')).estado, 403);
    await noExisteAjeno(pedir, '/plan', ajena.plan.id);
    assert.equal((await pedir('/plan', 'POST', { nombre: 'Fuera de alcance', semanas: 5, objetivoId: ajena.objetivo.id })).estado, 403);
    assert.equal((await pedir(`/plan/${rama.plan.id}`, 'PATCH', { objetivoId: ajena.objetivo.id })).estado, 403, 'No se puede reasignar un plan propio a una cadena ajena');
    assert.equal((await pedir(`/plan/${rama.plan.id}`, 'PUT', { ...rama.plan, objetivoId: ajena.objetivo.id })).estado, 403);
    const sinCambio = await pedir(`/plan/${rama.plan.id}`);
    assert.equal(sinCambio.data.objetivoId, rama.objetivo.id, 'Un cambio rechazado no debe persistir');
    const lote = await pedir('/plan/batch', 'DELETE', [ajena.plan.id]);
    assert.ok(lote.estado === 403 || (lote.estado === 200 && lote.deletedCount === 0), 'El borrado por lote respeta la pertenencia');
    assert.equal((await api(`/plan/${ajena.plan.id}`)).estado, 200, 'El plan ajeno sigue existiendo');
    const alta = await pedir('/plan', 'POST', { nombre: 'Alta autorizada', semanas: 4, objetivoId: rama.objetivo.id });
    assert.equal(alta.estado, 201);
    assert.equal((await pedir(`/plan/${alta.data.id}`, 'DELETE')).estado, 200);
  }

  // La identidad de negocio no puede elegirse desde el registro público.
  const reclamacion = await api('/auth/registro', 'POST', { correo: 'reclamo@prueba.test', clave: '12345678', rol: 'CLIENTE', nombre: 'Reclamo', referenciaId: clienteB.id });
  assert.equal(reclamacion.estado, 400, 'Registro público no puede apropiarse de una ficha ajena');
  const sinEnlace = await api('/auth/registro', 'POST', { correo: 'sin-enlace@prueba.test', clave: '12345678', rol: 'CLIENTE', nombre: 'Sin enlace' });
  assert.equal(sinEnlace.estado, 201);
  assert.equal((await api('/plan', 'GET', undefined, sinEnlace.data.token)).estado, 403, 'Cuenta sin enlace no puede consultar alcance propio');
  assert.equal((await api('/cuentas', 'POST', { correo: 'inexistente@prueba.test', clave: '12345678', rol: 'CLIENTE', referenciaId: 'NO-EXISTE' })).estado, 400, 'Administración también valida la entidad vinculada');
  assert.equal((await api('/cuentas', 'POST', { correo: 'duplicada@prueba.test', clave: '12345678', rol: 'CLIENTE', referenciaId: clienteA.id })).estado, 400, 'No se duplica una identidad de negocio entre cuentas del mismo rol');
  const cuentaPendiente = (await api('/cuentas')).data.find(cuenta => cuenta.correo === 'sin-enlace@prueba.test');
  assert.ok(cuentaPendiente?.id);
  assert.equal((await ca(`/cuentas/${cuentaPendiente.id}/vinculo`, 'PUT', { referenciaId: clienteA.id })).estado, 403);
  assert.equal((await api(`/cuentas/${cuentaPendiente.id}/vinculo`, 'PUT', { referenciaId: 'NO-EXISTE' })).estado, 400);
  const clientePendiente = await crear('/cliente', { id: 'CLI-PENDIENTE', nombre: 'Cliente aprobado', correo: 'aprobado@dominio.test' });
  assert.equal((await api(`/cuentas/${cuentaPendiente.id}/vinculo`, 'PUT', { referenciaId: clientePendiente.id })).estado, 200);
  await listaPropia(sesion(sinEnlace.data.token), '/cliente', [clientePendiente.id]);

  // Cambios reales de cuenta deben tener efecto con el token emitido anteriormente.
  const datos = new pg.Client({ ...configuracion, database: base });
  try {
    await datos.connect();
    await datos.query('UPDATE usuario SET vinculo_verificado = false WHERE correo = $1', ['sin-enlace@prueba.test']);
    const pendiente = sesion(sinEnlace.data.token);
    assert.equal((await pendiente('/plan')).estado, 403, 'Una referencia histórica sin verificación no concede alcance');
    assert.ok((await pendiente('/auth/yo')).data.referenciaId == null, 'La sesión no publica como confiable un vínculo no verificado');
    assert.equal((await api(`/cuentas/${cuentaPendiente.id}/vinculo`, 'PUT', { referenciaId: clientePendiente.id })).estado, 200);
    await listaPropia(pendiente, '/cliente', [clientePendiente.id]);
    assert.equal((await api(`/cuentas/${cuentaPendiente.id}/vinculo`, 'PUT', { referenciaId: null })).estado, 200);
    assert.equal((await pendiente('/plan')).estado, 403, 'Administración puede desvincular y revocar acceso');
    // Una identidad de negocio pertenece como máximo a una cuenta del mismo rol.
    // Liberar la cuenta B permite una reasignación administrativa válida hacia A.
    await datos.query('UPDATE usuario SET referencia_id = NULL WHERE correo = $1', ['cliente-b@prueba.test']);
    assert.equal((await cb('/plan')).estado, 403, 'Desvincular revoca el alcance aunque el token siga vigente');
    await datos.query('UPDATE usuario SET referencia_id = $1 WHERE correo = $2', [clienteB.id, 'cliente-a@prueba.test']);
    await listaPropia(ca, '/plan', [b.plan.id]);
    assert.equal((await ca(`/plan/${a.plan.id}`)).estado, 403);
    assert.equal((await ca('/auth/yo')).data.referenciaId, clienteB.id);
    await datos.query('UPDATE usuario SET rol = $1, referencia_id = $2 WHERE correo = $3', ['CLIENTE', clienteA.id, 'entrenador-a@prueba.test']);
    assert.equal((await ea('/auth/yo')).data.rol, 'CLIENTE');
    assert.equal((await ea(`/plan/${a.plan.id}`, 'PATCH', { semanas: 10 })).estado, 403, 'El rol antiguo del token no conserva permisos');
    await datos.query('UPDATE usuario SET referencia_id = NULL WHERE correo = $1', ['cliente-b@prueba.test']);
    assert.equal((await cb('/plan')).estado, 403, 'Desvincular revoca el alcance aunque el token siga vigente');
  } finally { await datos.end(); }
  console.log('OK permisos: dos clientes y dos entrenadores aislados; módulos, CRUD, count/exists, navegación, registro y cambios de identidad comprobados.');
}
