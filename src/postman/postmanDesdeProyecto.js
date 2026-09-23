/**
 * Colección de Postman y guía en texto para probar el backend Spring Boot generado.
 *
 * Se arman leyendo el PROYECTO YA GENERADO (controladores, DTO, propiedades, cuentas de prueba),
 * no el diagrama: así las rutas, los nombres de los campos, los tipos y las reglas de sesión
 * coinciden siempre con lo que el backend responde, aunque el generador cambie.
 */
import fs from 'node:fs';
import path from 'node:path';

const JAVA = 'src/main/java/com/example/demo';
const INFRAESTRUCTURA = new Set(['Auth', 'Asistente', 'Cuentas']);

const leer = (archivo) => (fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8') : '');

/** Valor de una propiedad; resuelve ${VARIABLE:valorPorDefecto} a su valor por defecto. */
const propiedad = (texto, clave) => {
    const m = texto.match(new RegExp(`^${clave.replace(/\./g, '\\.')}=(.*)$`, 'm'));
    if (!m) return null;
    const valor = m[1].trim();
    const conDefecto = valor.match(/^\$\{[^:}]+:(.*)\}$/);
    return conDefecto ? conDefecto[1] : valor;
};

const listaDe = (texto) => String(texto || '').split(',').map((x) => x.trim()).filter(Boolean);

/** Campos de un DTO: tipo, nombre, si es obligatorio y largo máximo. */
const camposDelDto = (fuente) => {
    const campos = [];
    let anotaciones = [];
    for (const linea of fuente.split('\n')) {
        const t = linea.trim();
        if (t.startsWith('@')) { anotaciones.push(t); continue; }
        const m = t.match(/^private\s+(?!static)([\w<>, ]+?)\s+(\w+)\s*;\s*(?:\/\/\s*(.*))?$/);
        if (m) {
            const [, tipo, nombre, comentario = ''] = m;
            const maximo = anotaciones.map((a) => a.match(/max\s*=\s*(\d+)/)).find(Boolean);
            campos.push({
                tipo: tipo.replace(/\s+/g, ''),
                nombre,
                obligatorio: anotaciones.some((a) => /^@(NotNull|NotBlank|NotEmpty)\b/.test(a)),
                maximo: maximo ? Number(maximo[1]) : null,
                referencia: (comentario.match(/(?:FK to|con)\s+(\w+)/) || [])[1] || null,
            });
        }
        if (t && !t.startsWith('@')) anotaciones = [];
    }
    return campos;
};

/**
 * Campos de un DTO más los que hereda: ClienteNaturalDTO extends ClienteDTO recibe también
 * nombre, telefono… del padre, y el backend los exige al crear.
 */
const camposConHerencia = (dto, leerDto, visitados = new Set()) => {
    if (!dto || visitados.has(dto)) return [];
    visitados.add(dto);
    const fuente = leerDto(dto);
    const padre = (fuente.match(/class\s+\w+\s+extends\s+(\w+DTO)\b/) || [])[1];
    const propios = camposDelDto(fuente);
    const heredados = padre ? camposConHerencia(padre, leerDto, visitados) : [];
    const nombres = new Set(propios.map((c) => c.nombre));
    return [...heredados.filter((c) => !nombres.has(c.nombre)), ...propios];
};

/** Lee del proyecto generado todo lo que hace falta para llamar a su API. */
export const leerContratoApi = (carpeta, nombreProyecto) => {
    const propiedades = leer(path.join(carpeta, 'src/main/resources/application.properties'));
    const puerto = propiedad(propiedades, 'server.port') || '8080';
    const authActiva = propiedad(propiedades, 'app.auth.activa') !== 'false';
    const gestores = listaDe(propiedad(propiedades, 'app.auth.roles-gestores'));
    const registroPublico = listaDe(propiedad(propiedades, 'app.auth.roles-registro-publico'));
    const claveDemo = propiedad(propiedades, 'app.auth.clave-demo') || '12345678';
    const cuentasDemo = propiedad(propiedades, 'app.auth.cuentas-demo') !== 'false';
    const baseDatos = (propiedad(propiedades, 'spring.datasource.url') || '').split('/').pop() || '';

    const servicioAuth = leer(path.join(carpeta, JAVA, 'services/AuthService.java'));
    const roles = ((servicioAuth.match(/ROLES\s*=\s*List\.of\(([^)]*)\)/) || [])[1] || '')
        .split(',').map((r) => r.trim().replace(/"/g, '')).filter(Boolean);

    const datosDemo = leer(path.join(carpeta, JAVA, 'config/DatosDemo.java'));
    const carpetaControladores = path.join(carpeta, JAVA, 'controllers');
    const controladores = fs.existsSync(carpetaControladores) ? fs.readdirSync(carpetaControladores) : [];

    const entidades = [];
    for (const archivo of controladores.sort()) {
        const entidad = archivo.replace(/Controller\.java$/, '');
        if (!archivo.endsWith('Controller.java') || INFRAESTRUCTURA.has(entidad)) continue;
        const fuente = leer(path.join(carpetaControladores, archivo));
        const ruta = (fuente.match(/@RequestMapping\("([^"]+)"\)/) || [])[1];
        if (!ruta) continue;
        const tipoId = (fuente.match(/getById\(@PathVariable\s+(\w+)\s+id\)/) || [])[1] || 'Long';
        const relacionadas = [...fuente.matchAll(/@GetMapping\("\/\{id\}\/(\w+)"\)/g)].map((m) => m[1]);
        const campos = camposConHerencia(`${entidad}DTO`, (dto) => leer(path.join(carpeta, JAVA, 'dto', `${dto}.java`)));
        // Id de un registro sembrado: numérico (1) o el código de texto que puso DatosDemo
        const sembrado = datosDemo.match(new RegExp(`${entidad}\\s+(\\w+)1\\s*=\\s*new\\s+${entidad}\\(\\);\\s*\\n\\s*\\1\\.setId\\("([^"]+)"\\)`));
        entidades.push({
            nombre: entidad,
            ruta,
            tipoId,
            idTexto: tipoId === 'String' || tipoId === 'UUID',
            idEjemplo: sembrado ? sembrado[2] : (tipoId === 'String' ? '' : '1'),
            relacionadas,
            campos,
            tienePatch: /@PatchMapping\("\/\{id\}"\)/.test(fuente),
            tieneConteo: /@GetMapping\("\/count"\)/.test(fuente),
        });
    }

    const asistente = leer(path.join(carpetaControladores, 'AsistenteController.java'));
    return {
        nombre: nombreProyecto,
        puerto,
        baseDatos,
        auth: {
            activa: authActiva,
            roles,
            gestores,
            consulta: roles.filter((r) => !gestores.includes(r)),
            registroPublico,
            cuentasDemo,
            claveDemo,
        },
        asistente: /@RequestMapping\("\/api\/asistente"\)/.test(asistente),
        entidades,
    };
};

// ───────────────────────── valores de ejemplo ─────────────────────────

const variableId = (entidad) => `${entidad.charAt(0).toLowerCase()}${entidad.slice(1)}Id`
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

const hoy = () => new Date().toISOString().slice(0, 10);

const textoDeEjemplo = (nombre) => {
    const n = nombre.toLowerCase();
    if (/correo|email/.test(n)) return 'nuevo@demo.com';
    if (/telefono|celular|movil/.test(n)) return '70000000';
    if (/^ci$|dni|nit|documento|carnet/.test(n)) return '9876543';
    if (/hora/.test(n)) return '08:30';
    if (/estado|status/.test(n)) return 'ACTIVO';
    if (/sexo|genero/.test(n)) return 'F';
    if (/url|imagen|foto|video|archivo/.test(n)) return 'https://ejemplo.com/archivo.jpg';
    if (/descripcion|detalle|observacion|nota/.test(n)) return 'Registro creado desde Postman';
    if (/codigo|clave|sku|matricula|placa/.test(n)) return 'COD-100';
    if (/direccion|domicilio/.test(n)) return 'Av. Ejemplo 123';
    if (/apellido/.test(n)) return 'Prueba';
    if (/nombre|titulo|name/.test(n)) return 'Ejemplo Postman';
    return `${nombre} de ejemplo`;
};

/**
 * Cuerpo JSON de ejemplo como TEXTO: las claves foráneas usan variables de Postman
 * ({{pacienteId}}) que apuntan a registros sembrados, así el POST funciona de entrada.
 */
const cuerpoDeEjemplo = (entidad, porNombre) => {
    const lineas = [];
    for (const c of entidad.campos) {
        if (c.nombre === 'id') continue;
        let valor;
        const destino = c.referencia && porNombre.get(c.referencia);
        const esLista = c.tipo.startsWith('List<');
        if (destino || /Ids?$/.test(c.nombre) && (c.tipo.includes('Integer') || c.tipo.includes('Long') || c.tipo.includes('String'))) {
            const ref = destino || porNombre.get(c.nombre.replace(/Ids?$/, '').replace(/^\w/, (x) => x.toUpperCase()));
            const variable = ref ? `{{${variableId(ref.nombre)}}}` : '1';
            const comoValor = ref && ref.idTexto ? `"${variable}"` : variable;
            valor = esLista ? `[${comoValor}]` : comoValor;
        } else if (/^(Integer|Long|Short|int|long)$/.test(c.tipo)) {
            valor = '1';
        } else if (/^(Double|Float|BigDecimal|double|float)$/.test(c.tipo)) {
            valor = '10.5';
        } else if (/^(Boolean|boolean)$/.test(c.tipo)) {
            valor = 'true';
        } else if (c.tipo === 'LocalDate') {
            valor = `"${hoy()}"`;
        } else if (c.tipo === 'LocalDateTime') {
            valor = `"${hoy()}T08:30:00"`;
        } else if (c.tipo === 'LocalTime') {
            valor = '"08:30:00"';
        } else if (esLista) {
            valor = '[]';
        } else {
            let texto = textoDeEjemplo(c.nombre);
            if (c.maximo && texto.length > c.maximo) texto = texto.slice(0, c.maximo);
            valor = JSON.stringify(texto);
        }
        lineas.push(`  "${c.nombre}": ${valor}`);
    }
    return `{\n${lineas.join(',\n')}\n}`;
};

// ───────────────────────── colección de Postman ─────────────────────────

const url = (ruta, consulta = []) => {
    const segmentos = ruta.replace(/^\//, '').split('/');
    return {
        raw: `{{baseUrl}}/${segmentos.join('/')}${consulta.length ? `?${consulta.filter((q) => !q.disabled).map((q) => `${q.key}=${q.value}`).join('&')}` : ''}`,
        host: ['{{baseUrl}}'],
        path: segmentos,
        ...(consulta.length ? { query: consulta } : {}),
    };
};

const JSON_CABECERA = [{ key: 'Content-Type', value: 'application/json' }];

const pruebaExito = (extra = '') => ({
    listen: 'test',
    script: {
        type: 'text/javascript',
        exec: [
            "pm.test('Responde sin error', () => pm.expect(pm.response.code).to.be.below(300));",
            ...(extra ? extra.split('\n') : []),
        ],
    },
});

/** Script que corre tras iniciar sesión: guarda el token y trae un id existente de cada tabla. */
const guardarToken = (entidades = []) => ({
    listen: 'test',
    script: {
        type: 'text/javascript',
        exec: [
            "pm.test('Sesión iniciada', () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));",
            'const datos = pm.response.json().data || {};',
            "if (datos.token) { pm.collectionVariables.set('token', datos.token); console.log('Token guardado para ' + datos.correo + ' (' + datos.rol + ')'); }",
            '// Un id que exista de verdad en cada tabla, para Obtener, Actualizar y las claves foráneas',
            `const tablas = ${JSON.stringify(entidades.map((e) => ({ variable: variableId(e.nombre), ruta: e.ruta })))};`,
            // pm.variables respeta la precedencia: un entorno de Postman pisa el valor de la colección
            "const base = pm.variables.get('baseUrl');",
            'if (datos.token) tablas.forEach((t) => pm.sendRequest({',
            "    url: base + t.ruta + '?pagina=0&tamano=1',",
            "    header: { Authorization: 'Bearer ' + datos.token },",
            '}, (error, respuesta) => {',
            '    if (error || !respuesta || respuesta.code !== 200) return;',
            '    const lista = (respuesta.json() || {}).data || [];',
            "    if (lista.length && lista[0].id !== undefined) { pm.collectionVariables.set(t.variable, lista[0].id); pm.collectionVariables.set(t.variable + 'Ejemplo', lista[0].id); }",
            '}));',
        ],
    },
});

const peticion = (nombre, metodo, ruta, { cuerpo, consulta, eventos, sinSesion, descripcion } = {}) => ({
    name: nombre,
    ...(eventos ? { event: eventos } : {}),
    request: {
        method: metodo,
        ...(sinSesion ? { auth: { type: 'noauth' } } : {}),
        header: cuerpo ? JSON_CABECERA : [],
        ...(cuerpo ? { body: { mode: 'raw', raw: cuerpo, options: { raw: { language: 'json' } } } } : {}),
        url: url(ruta, consulta),
        ...(descripcion ? { description: descripcion } : {}),
    },
});

export const coleccionPostman = (contrato) => {
    const { auth } = contrato;
    const porNombre = new Map(contrato.entidades.map((e) => [e.nombre, e]));
    const gestor = auth.gestores[0] || auth.roles[0];
    const variables = [
        { key: 'baseUrl', value: `http://localhost:${contrato.puerto}` },
        { key: 'token', value: '' },
        { key: 'clave', value: auth.claveDemo },
        ...contrato.entidades.map((e) => ({ key: variableId(e.nombre), value: e.idEjemplo || '1' })),
    ];

    const sesion = {
        name: '0. Sesión (empieza aquí)',
        description: 'Inicia sesión primero: el token se guarda solo en la variable {{token}} y todas las demás peticiones lo envían como "Authorization: Bearer ...".',
        item: [
            peticion('Roles del sistema', 'GET', '/api/auth/roles', { sinSesion: true, eventos: [pruebaExito()] }),
            ...(auth.registroPublico.length ? [peticion(`Registrarse como ${auth.registroPublico[0]}`, 'POST', '/api/auth/registro', {
                sinSesion: true,
                eventos: [guardarToken(contrato.entidades)],
                // {{$timestamp}} hace un correo distinto cada vez: se puede repetir sin "ya existe"
                cuerpo: JSON.stringify({ correo: 'nuevo{{$timestamp}}@demo.com', clave: '{{clave}}', rol: auth.registroPublico[0], nombre: 'Usuario Nuevo' }, null, 2),
            })] : []),
            ...[...auth.consulta, ...auth.gestores].filter((rol) => auth.roles.includes(rol)).map((rol) => peticion(
                `Iniciar sesión como ${rol}${auth.gestores.includes(rol) ? ' (puede crear, editar y borrar)' : ' (solo consulta)'}`,
                'POST', '/api/auth/login', {
                    sinSesion: true,
                    eventos: [guardarToken(contrato.entidades)],
                    cuerpo: JSON.stringify({ correo: `${rol.toLowerCase()}@demo.com`, clave: '{{clave}}' }, null, 2),
                },
            )),
            peticion('¿Quién soy? (datos de la sesión)', 'GET', '/api/auth/yo', { eventos: [pruebaExito()] }),
        ],
    };

    const carpetas = contrato.entidades.map((e) => {
        const variable = `{{${variableId(e.nombre)}}}`;
        const cuerpo = cuerpoDeEjemplo(e, porNombre);
        const guardarId = `const creado = (pm.response.json() || {}).data;\nif (creado && creado.id !== undefined) { pm.collectionVariables.set('${variableId(e.nombre)}', creado.id); console.log('${e.nombre} creado con id ' + creado.id); }`;
        return {
            name: e.nombre,
            item: [
                peticion(`Listar ${e.nombre}`, 'GET', e.ruta, {
                    eventos: [pruebaExito(`const lista = (pm.response.json() || {}).data || [];\nif (lista.length && lista[0].id !== undefined && !pm.collectionVariables.get('${variableId(e.nombre)}Ejemplo')) pm.collectionVariables.set('${variableId(e.nombre)}', lista[0].id);`)],
                    consulta: [
                        { key: 'pagina', value: '0', disabled: true, description: 'Página, empieza en 0 (sin pagina ni tamano devuelve todo)' },
                        { key: 'tamano', value: '10', disabled: true, description: 'Registros por página (máximo 200)' },
                        { key: 'buscar', value: '', disabled: true, description: 'Texto a buscar' },
                        { key: 'orden', value: 'id,desc', disabled: true, description: 'campo,asc o campo,desc' },
                    ],
                }),
                peticion(`Obtener ${e.nombre} por id`, 'GET', `${e.ruta}/${variable}`, { eventos: [pruebaExito()] }),
                peticion(`Crear ${e.nombre}`, 'POST', e.ruta, { cuerpo, eventos: [pruebaExito(guardarId)] }),
                peticion(`Actualizar ${e.nombre}`, 'PUT', `${e.ruta}/${variable}`, { cuerpo, eventos: [pruebaExito()] }),
                ...(e.tienePatch ? [peticion(`Actualizar parte de ${e.nombre}`, 'PATCH', `${e.ruta}/${variable}`, {
                    cuerpo: (() => {
                        const primero = cuerpo.split('\n')[1];
                        return primero ? `{\n${primero.replace(/,$/, '')}\n}` : '{}';
                    })(),
                    eventos: [pruebaExito()],
                })] : []),
                ...e.relacionadas.map((r) => peticion(`${e.nombre} → ${r}`, 'GET', `${e.ruta}/${variable}/${r}`, { eventos: [pruebaExito()] })),
                ...(e.tieneConteo ? [peticion(`Contar ${e.nombre}`, 'GET', `${e.ruta}/count`, { eventos: [pruebaExito()] })] : []),
                peticion(`Eliminar ${e.nombre}`, 'DELETE', `${e.ruta}/${variable}`, {
                    eventos: [pruebaExito(`pm.collectionVariables.set('${variableId(e.nombre)}', pm.collectionVariables.get('${variableId(e.nombre)}Ejemplo') || ${JSON.stringify(e.idEjemplo || '1')});`)],
                    descripcion: 'Borra el registro de la variable. Ejecuta antes "Crear" para borrar el que creaste y no un dato de ejemplo.',
                }),
            ],
        };
    });

    const asistente = contrato.asistente ? [{
        name: 'Asistente de IA',
        item: [
            peticion('¿Está configurado?', 'GET', '/api/asistente/estado', { eventos: [pruebaExito()] }),
            peticion('Preguntar al asistente', 'POST', '/api/asistente', {
                cuerpo: JSON.stringify({ pregunta: `¿Qué datos necesito para registrar ${contrato.entidades[0]?.nombre || 'un registro'}?` }, null, 2),
                eventos: [pruebaExito()],
            }),
        ],
    }] : [];

    return {
        info: {
            name: `${contrato.nombre} - API REST`,
            description: `API del backend Spring Boot generado desde el diagrama "${contrato.nombre}".\n\n`
                + `1. Arranca el backend (mvnw spring-boot:run) con la base "${contrato.baseDatos}" creada.\n`
                + `2. Ejecuta "0. Sesión → Iniciar sesión como ${gestor}": el token queda guardado solo.\n`
                + '3. Prueba cualquier carpeta. Crear guarda el id nuevo para usarlo en Obtener, Actualizar y Eliminar.\n\n'
                + 'La guía completa está en COMO_LLAMAR_LA_API.txt.',
            schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
        variable: variables,
        item: [sesion, ...carpetas, ...asistente],
    };
};

// ───────────────────────── guía en texto ─────────────────────────

const linea = (n = 78, c = '=') => c.repeat(n);

export const guiaApi = (contrato) => {
    const { auth } = contrato;
    const base = `http://localhost:${contrato.puerto}`;
    const porNombre = new Map(contrato.entidades.map((e) => [e.nombre, e]));
    const gestor = auth.gestores[0] || auth.roles[0] || 'ADMIN';
    const correoGestor = `${gestor.toLowerCase()}@demo.com`;
    const r = [];
    const p = (...x) => r.push(...x);

    p(linea(), `  CÓMO LLAMAR A LA API  -  ${contrato.nombre}`, linea(), '',
        'Esta guía explica cómo probar el backend Spring Boot generado, con Postman o con curl.',
        `Dirección base: ${base}`, '');

    p('1. ANTES DE EMPEZAR', linea(78, '-'),
        `  a) Crea la base de datos PostgreSQL "${contrato.baseDatos}" (el script está en database/).`,
        '  b) Arranca el backend desde la carpeta del proyecto:',
        '       Windows:     mvnw.cmd spring-boot:run',
        '       Linux/Mac:   ./mvnw spring-boot:run',
        `  c) Espera el mensaje "Started DemoApplication". La API queda en ${base}/api/...`,
        '  d) Al arrancar con la base vacía se crean datos de ejemplo (3 registros por tabla)',
        '     y las cuentas de prueba, así que puedes probar todo sin cargar nada a mano.', '');

    p('2. USAR LA COLECCIÓN DE POSTMAN', linea(78, '-'),
        '  a) Postman → Import → elige el archivo .postman_collection.json de esta carpeta.',
        '  b) Abre la carpeta "0. Sesión (empieza aquí)" y ejecuta "Iniciar sesión como ' + gestor + '".',
        '     El token se guarda solo en la variable {{token}} y se envía en todas las demás.',
        '  c) Cada carpeta es una tabla del diagrama: Listar, Obtener, Crear, Actualizar, Eliminar.',
        '     "Crear" guarda el id nuevo en su variable, así "Obtener", "Actualizar" y "Eliminar"',
        '     trabajan sobre el registro que acabas de crear.',
        '  d) Para correr todo de una vez: clic derecho en la colección → Run collection.',
        '  Variables de la colección (pestaña Variables): baseUrl, token, clave y un id por tabla.', '');

    p('3. INICIAR SESIÓN Y USAR EL TOKEN', linea(78, '-'));
    if (!auth.activa) {
        p('  El inicio de sesión está desactivado (app.auth.activa=false): no hace falta token.', '');
    } else {
        p('  Todas las rutas /api/... piden un token, salvo /api/auth/login, /api/auth/registro',
            '  y /api/auth/roles. El token dura unas horas; si expira, vuelve a iniciar sesión.', '',
            '  PASO 1 - Pedir el token:',
            `     POST ${base}/api/auth/login`,
            '     Content-Type: application/json',
            `     { "correo": "${correoGestor}", "clave": "${auth.claveDemo}" }`, '',
            '     Respuesta:',
            '     { "success": true, "message": "Sesión iniciada",',
            `       "data": { "token": "eyJ...", "correo": "${correoGestor}", "rol": "${gestor}", ... } }`, '',
            '  PASO 2 - Enviar el token en cada petición, en la cabecera:',
            '     Authorization: Bearer eyJ...', '',
            '  Cuentas de prueba (se crean al arrancar con la base vacía):');
        for (const rol of auth.roles) {
            p(`     ${`${rol.toLowerCase()}@demo.com`.padEnd(32)} clave ${auth.claveDemo}   ${auth.gestores.includes(rol) ? 'crea, edita y borra' : 'solo consulta'}`);
        }
        if (auth.registroPublico.length) {
            p('', `  Cualquiera puede registrarse con el rol ${auth.registroPublico.join(' o ')}:`,
                `     POST ${base}/api/auth/registro`,
                `     { "correo": "nuevo@demo.com", "clave": "${auth.claveDemo}", "rol": "${auth.registroPublico[0]}", "nombre": "Usuario Nuevo" }`);
        }
        p('', '  Otras rutas de sesión:',
            `     GET ${base}/api/auth/roles     roles del sistema (sin token)`,
            `     GET ${base}/api/auth/yo        datos de la sesión actual`, '');
    }

    p('4. RUTAS DE CADA TABLA', linea(78, '-'),
        '  Todas siguen el mismo esquema. {id} es la clave del registro.', '',
        '     GET    /api/<tabla>              listar (acepta ?pagina=0&tamano=10&buscar=texto&orden=campo,desc)',
        '     GET    /api/<tabla>/{id}         obtener uno',
        '     POST   /api/<tabla>              crear (cuerpo JSON)',
        '     PUT    /api/<tabla>/{id}         reemplazar (cuerpo JSON completo)',
        '     PATCH  /api/<tabla>/{id}         cambiar solo algunos campos',
        '     DELETE /api/<tabla>/{id}         eliminar',
        '     GET    /api/<tabla>/count        cuántos registros hay', '');

    for (const e of contrato.entidades) {
        p(`  ${e.nombre}`, `  ${linea(Math.max(e.nombre.length, 8), '~')}`,
            `     Ruta: ${base}${e.ruta}`,
            `     Clave: ${e.idTexto ? `texto (${e.idEjemplo ? `p. ej. "${e.idEjemplo}"` : 'se genera sola si no la envías'})` : `número (p. ej. ${e.idEjemplo || 1})`}${e.idTexto ? '. Si no la envías al crear, el sistema la genera.' : '. La genera la base de datos: no la envíes al crear.'}`);
        const campos = e.campos.filter((c) => c.nombre !== 'id');
        if (campos.length) {
            p('     Campos:');
            for (const c of campos) {
                const extra = [c.obligatorio ? 'obligatorio' : 'opcional'];
                if (c.maximo && c.maximo < 255) extra.push(`máx. ${c.maximo} caracteres`);
                if (c.referencia) extra.push(`id de ${c.referencia}`);
                if (c.tipo === 'LocalDate') extra.push('formato AAAA-MM-DD');
                if (c.tipo === 'LocalDateTime') extra.push('formato AAAA-MM-DDTHH:MM:SS');
                p(`        - ${c.nombre.padEnd(22)} ${c.tipo.padEnd(14)} ${extra.join(', ')}`);
            }
        }
        const ejemplo = cuerpoDeEjemplo(e, porNombre).replace(/\{\{(\w+)\}\}/g, (_, v) => {
            const ref = contrato.entidades.find((x) => variableId(x.nombre) === v);
            return ref ? (ref.idEjemplo || '1') : '1';
        });
        p('     Ejemplo para crear (POST):', ...ejemplo.split('\n').map((l) => `        ${l}`));
        if (e.relacionadas.length) p(`     Relacionados: ${e.relacionadas.map((x) => `GET ${e.ruta}/{id}/${x}`).join('  ·  ')}`);
        p('');
    }

    const primera = contrato.entidades[0];
    if (primera) {
        const cuerpo = cuerpoDeEjemplo(primera, porNombre).replace(/\{\{(\w+)\}\}/g, (_, v) => {
            const ref = contrato.entidades.find((x) => variableId(x.nombre) === v);
            return ref ? (ref.idEjemplo || '1') : '1';
        }).replace(/\n\s*/g, ' ');
        const idUno = primera.idEjemplo || '1';
        p('5. EJEMPLOS CON CURL', linea(78, '-'),
            '  En PowerShell usa curl.exe (no curl). En Git Bash, Linux o Mac funciona tal cual.', '',
            '  # Iniciar sesión y copiar el token de la respuesta',
            `  curl.exe -X POST ${base}/api/auth/login -H "Content-Type: application/json" -d "{\\"correo\\":\\"${correoGestor}\\",\\"clave\\":\\"${auth.claveDemo}\\"}"`, '',
            `  # Listar ${primera.nombre}`,
            `  curl.exe ${base}${primera.ruta} -H "Authorization: Bearer TU_TOKEN"`, '',
            `  # Obtener ${primera.nombre} ${idUno}`,
            `  curl.exe ${base}${primera.ruta}/${idUno} -H "Authorization: Bearer TU_TOKEN"`, '',
            `  # Crear ${primera.nombre}`,
            `  curl.exe -X POST ${base}${primera.ruta} -H "Authorization: Bearer TU_TOKEN" -H "Content-Type: application/json" -d "${cuerpo.replace(/"/g, '\\"')}"`, '',
            `  # Eliminar ${primera.nombre} (usa el id que devolvió Crear)`,
            `  curl.exe -X DELETE ${base}${primera.ruta}/ID_CREADO -H "Authorization: Bearer TU_TOKEN"`, '');
    }

    p('6. FORMATO DE LAS RESPUESTAS', linea(78, '-'),
        '  Todas responden JSON con la misma forma:',
        '     { "success": true,  "message": "...", "data": { ... } }         un registro',
        '     { "success": true,  "message": "...", "data": [ ... ], "total": 3 }  una lista',
        '     { "success": false, "message": "explicación del problema" }        un error', '',
        '  Códigos HTTP:',
        '     200  todo bien                     201  registro creado',
        '     400  datos inválidos (falta un campo obligatorio, formato de fecha, etc.)',
        '     401  sin token o token vencido: inicia sesión de nuevo',
        '     403  tu rol no puede hacer eso (p. ej. un rol de consulta intentando crear)',
        '     404  no existe un registro con ese id',
        '     409  choca con otro dato (clave repetida o registro usado por otra tabla)', '');

    if (contrato.asistente) {
        p('7. ASISTENTE DE IA', linea(78, '-'),
            '  Responde preguntas sobre el sistema. Necesita GEMINI_API_KEY o DEEPSEEK_API_KEY',
            '  como variables de entorno del backend (si no, /estado lo indica).',
            `     GET  ${base}/api/asistente/estado`,
            `     POST ${base}/api/asistente      { "pregunta": "¿Qué datos pide un registro?" }`, '');
    }

    p('8. PROBLEMAS FRECUENTES', linea(78, '-'),
        '  - "Connection refused": el backend no está corriendo o usa otro puerto (server.port).',
        '  - 401 en todo: falta iniciar sesión, o el token se copió sin la palabra "Bearer ".',
        '  - 403 al crear: la cuenta es de consulta; usa una de gestión (' + auth.gestores.join(', ') + ').',
        '  - 400 en una fecha: el formato es AAAA-MM-DD (p. ej. ' + hoy() + ').',
        '  - 404 con un id de ejemplo: lista primero para ver los ids reales. En las clases que heredan de',
        '    otra (p. ej. una subclase) los ids siguen la numeración del padre y no empiezan en 1.',
        '    La colección lo resuelve sola: al iniciar sesión guarda un id existente de cada tabla.',
        '  - 409 al eliminar: el registro está usado por otra tabla; borra primero el que depende de él.', '');

    return r.join('\r\n');
};

/** Deja la colección y la guía en <proyecto>/postman/. Devuelve las rutas escritas. */
export const escribirPostman = (carpetaProyecto, nombreProyecto) => {
    const contrato = leerContratoApi(carpetaProyecto, nombreProyecto);
    const carpeta = path.join(carpetaProyecto, 'postman');
    fs.mkdirSync(carpeta, { recursive: true });
    const coleccion = path.join(carpeta, `${nombreProyecto}.postman_collection.json`);
    const guia = path.join(carpeta, 'COMO_LLAMAR_LA_API.txt');
    fs.writeFileSync(coleccion, JSON.stringify(coleccionPostman(contrato), null, 2), 'utf8');
    // BOM: el Bloc de notas de Windows muestra bien las tildes
    fs.writeFileSync(guia, `﻿${guiaApi(contrato)}`, 'utf8');
    return { coleccion, guia, contrato };
};
