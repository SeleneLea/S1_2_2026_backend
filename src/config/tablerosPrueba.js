/**
 * Tableros de ejemplo del servidor de pruebas: 2 simples, 2 medianos y 1 complejo. Pertenecen a
 * la cuenta prueba1 y la cuenta prueba2 queda invitada, para probar la edición conjunta.
 *
 * En cada arranque (o redespliegue) se restauran a este contenido y se borran los tableros extra
 * de las cuentas de prueba: el servidor vuelve siempre al mismo estado conocido. Los tableros de
 * las demás cuentas no se tocan.
 */
import pool from './db.js';

const clase = (id, className, x, y, attributes, methods) => ({
    id,
    type: 'classNode',
    position: { x, y },
    data: { className, attributes, methods }
});

const rel = (id, source, target, tipo, inicio = '', fin = '') => ({
    id,
    source,
    target,
    type: 'umlEdge',
    data: { type: tipo, startLabel: inicio, endLabel: fin }
});

// ---------------------------------------------------------------- 1. Tienda (simple)
const tienda = {
    titulo: 'Tienda en línea',
    descripcion: 'Ejemplo simple: clientes, pedidos y productos (4 clases).',
    nodes: [
        clase('cliente', 'Cliente', 0, 0,
            ['id: int', 'nombre: string', 'correo: string', 'direccion: string'],
            ['registrarse(): void', 'realizarPedido(): Pedido']),
        clase('pedido', 'Pedido', 460, 0,
            ['id: int', 'fecha: Date', 'estado: string', 'total: decimal'],
            ['calcularTotal(): decimal', 'cancelar(): void']),
        clase('detalle', 'DetallePedido', 460, 340,
            ['id: int', 'cantidad: int', 'precioUnitario: decimal'],
            ['subtotal(): decimal']),
        clase('producto', 'Producto', 0, 340,
            ['id: int', 'nombre: string', 'precio: decimal', 'stock: int'],
            ['hayStock(cantidad: int): boolean'])
    ],
    edges: [
        rel('tienda-cliente-pedido', 'cliente', 'pedido', 'Association', '1', '*'),
        rel('tienda-pedido-detalle', 'pedido', 'detalle', 'Composition', '1', '*'),
        rel('tienda-producto-detalle', 'producto', 'detalle', 'Association', '1', '*')
    ]
};

// ---------------------------------------------------------------- 2. Biblioteca (simple)
const biblioteca = {
    titulo: 'Biblioteca municipal',
    descripcion: 'Ejemplo simple: libros, ejemplares y préstamos (5 clases).',
    nodes: [
        clase('autor', 'Autor', 0, 0,
            ['id: int', 'nombre: string', 'nacionalidad: string'],
            ['librosPublicados(): int']),
        clase('libro', 'Libro', 440, 0,
            ['id: int', 'titulo: string', 'isbn: string', 'anio: int'],
            ['disponible(): boolean']),
        clase('ejemplar', 'Ejemplar', 880, 0,
            ['id: int', 'codigo: string', 'estado: string'],
            ['prestar(): void', 'devolver(): void']),
        clase('socio', 'Socio', 0, 360,
            ['id: int', 'nombre: string', 'carnet: string', 'activo: boolean'],
            ['puedePrestar(): boolean']),
        clase('prestamo', 'Prestamo', 440, 360,
            ['id: int', 'fechaPrestamo: Date', 'fechaDevolucion: Date', 'multa: decimal'],
            ['estaVencido(): boolean', 'calcularMulta(): decimal'])
    ],
    edges: [
        rel('biblio-autor-libro', 'autor', 'libro', 'Association', '1', '*'),
        rel('biblio-libro-ejemplar', 'libro', 'ejemplar', 'Composition', '1', '*'),
        rel('biblio-socio-prestamo', 'socio', 'prestamo', 'Association', '1', '*'),
        rel('biblio-prestamo-ejemplar', 'prestamo', 'ejemplar', 'Association', '*', '1')
    ]
};

// ---------------------------------------------------------------- 3. Clínica (mediano)
const clinica = {
    titulo: 'Clínica médica',
    descripcion: 'Ejemplo mediano: citas, consultas y recetas (8 clases).',
    nodes: [
        clase('paciente', 'Paciente', 0, 0,
            ['id: int', 'nombre: string', 'fechaNacimiento: Date', 'telefono: string'],
            ['edad(): int', 'solicitarCita(): Cita']),
        clase('cita', 'Cita', 440, 0,
            ['id: int', 'fecha: Date', 'hora: string', 'estado: string'],
            ['confirmar(): void', 'reprogramar(fecha: Date): void']),
        clase('medico', 'Medico', 880, 0,
            ['id: int', 'nombre: string', 'matricula: string'],
            ['agenda(fecha: Date): Cita[]']),
        clase('especialidad', 'Especialidad', 1320, 0,
            ['id: int', 'nombre: string', 'descripcion: string'],
            ['medicos(): Medico[]']),
        clase('historial', 'HistorialClinico', 0, 380,
            ['id: int', 'fechaApertura: Date', 'observaciones: string'],
            ['agregarConsulta(c: Consulta): void']),
        clase('consulta', 'Consulta', 440, 380,
            ['id: int', 'motivo: string', 'diagnostico: string', 'fecha: Date'],
            ['registrarDiagnostico(texto: string): void']),
        clase('receta', 'Receta', 880, 380,
            ['id: int', 'indicaciones: string', 'duracionDias: int'],
            ['imprimir(): void']),
        clase('medicamento', 'Medicamento', 1320, 380,
            ['id: int', 'nombre: string', 'presentacion: string', 'stock: int'],
            ['hayStock(): boolean'])
    ],
    edges: [
        rel('clinica-paciente-cita', 'paciente', 'cita', 'Association', '1', '*'),
        rel('clinica-medico-cita', 'medico', 'cita', 'Association', '1', '*'),
        rel('clinica-medico-especialidad', 'medico', 'especialidad', 'Association', '*', '1'),
        rel('clinica-cita-consulta', 'cita', 'consulta', 'Association', '1', '1'),
        rel('clinica-paciente-historial', 'paciente', 'historial', 'Composition', '1', '1'),
        rel('clinica-historial-consulta', 'historial', 'consulta', 'Aggregation', '1', '*'),
        rel('clinica-consulta-receta', 'consulta', 'receta', 'Composition', '1', '*'),
        rel('clinica-receta-medicamento', 'receta', 'medicamento', 'Association', '*', '*')
    ]
};

// ---------------------------------------------------------------- 4. Académico (mediano)
const academico = {
    titulo: 'Gestión académica',
    descripcion: 'Ejemplo mediano con herencia: cursos, inscripciones y evaluaciones (9 clases).',
    nodes: [
        clase('persona', 'Persona', 440, 0,
            ['id: int', 'nombre: string', 'ci: string', 'correo: string'],
            ['nombreCompleto(): string']),
        clase('estudiante', 'Estudiante', 60, 340,
            ['registro: string', 'semestre: int'],
            ['promedio(): decimal', 'inscribirse(c: Curso): Inscripcion']),
        clase('docente', 'Docente', 820, 340,
            ['codigo: string', 'gradoAcademico: string'],
            ['cursosAsignados(): Curso[]']),
        clase('inscripcion', 'Inscripcion', 60, 700,
            ['id: int', 'fecha: Date', 'estado: string'],
            ['notaFinal(): decimal', 'aprobado(): boolean']),
        clase('curso', 'Curso', 820, 700,
            ['id: int', 'nombre: string', 'sigla: string', 'creditos: int'],
            ['cupoDisponible(): int']),
        clase('carrera', 'Carrera', 1400, 700,
            ['id: int', 'nombre: string', 'duracionSemestres: int'],
            ['planDeEstudios(): Curso[]']),
        clase('evaluacion', 'Evaluacion', 60, 1060,
            ['id: int', 'tipo: string', 'nota: decimal', 'fecha: Date'],
            ['esAprobatoria(): boolean']),
        clase('aula', 'Aula', 820, 1060,
            ['id: int', 'codigo: string', 'capacidad: int'],
            ['estaLibre(horario: Horario): boolean']),
        clase('periodo', 'Periodo', 1400, 1060,
            ['id: int', 'gestion: string', 'fechaInicio: Date', 'fechaFin: Date'],
            ['estaVigente(): boolean'])
    ],
    edges: [
        rel('acad-estudiante-persona', 'estudiante', 'persona', 'Generalization'),
        rel('acad-docente-persona', 'docente', 'persona', 'Generalization'),
        rel('acad-estudiante-inscripcion', 'estudiante', 'inscripcion', 'Association', '1', '*'),
        rel('acad-inscripcion-curso', 'inscripcion', 'curso', 'Association', '*', '1'),
        rel('acad-docente-curso', 'docente', 'curso', 'Association', '1', '*'),
        rel('acad-inscripcion-evaluacion', 'inscripcion', 'evaluacion', 'Composition', '1', '*'),
        rel('acad-curso-aula', 'curso', 'aula', 'Association', '*', '1'),
        rel('acad-carrera-curso', 'carrera', 'curso', 'Aggregation', '1', '*'),
        rel('acad-curso-periodo', 'curso', 'periodo', 'Association', '*', '1')
    ]
};

// ---------------------------------------------------------------- 5. Banco (complejo)
const banco = {
    titulo: 'Sistema bancario',
    descripcion: 'Ejemplo complejo: herencia, composición y dependencias (15 clases).',
    nodes: [
        clase('cliente', 'Cliente', 620, 0,
            ['id: int', 'nombre: string', 'telefono: string', 'fechaAlta: Date'],
            ['esMoroso(): boolean']),
        clase('clienteNatural', 'ClienteNatural', 180, 320,
            ['ci: string', 'fechaNacimiento: Date'],
            ['edad(): int']),
        clase('clienteEmpresa', 'ClienteEmpresa', 1060, 320,
            ['nit: string', 'razonSocial: string', 'representante: string'],
            ['facturacionAnual(): decimal']),
        clase('cuenta', 'Cuenta', 620, 660,
            ['id: int', 'numero: string', 'saldo: decimal', 'moneda: string'],
            ['depositar(monto: decimal): void', 'retirar(monto: decimal): boolean']),
        clase('cuentaAhorro', 'CuentaAhorro', 380, 1000,
            ['tasaInteres: decimal'],
            ['calcularInteres(): decimal']),
        clase('cuentaCorriente', 'CuentaCorriente', 880, 1000,
            ['limiteSobregiro: decimal'],
            ['sobregiroDisponible(): decimal']),
        clase('tarjeta', 'Tarjeta', 1240, 660,
            ['id: int', 'numero: string', 'fechaVencimiento: Date', 'activa: boolean'],
            ['bloquear(): void']),
        clase('prestamo', 'Prestamo', 0, 660,
            ['id: int', 'monto: decimal', 'plazoMeses: int', 'tasa: decimal'],
            ['saldoPendiente(): decimal']),
        clase('cuota', 'Cuota', 0, 1000,
            ['numero: int', 'monto: decimal', 'fechaVencimiento: Date', 'pagada: boolean'],
            ['estaVencida(): boolean']),
        clase('movimiento', 'Movimiento', 620, 1340,
            ['id: int', 'fecha: Date', 'monto: decimal', 'descripcion: string'],
            ['aplicar(): void']),
        clase('deposito', 'Deposito', 180, 1680,
            ['origen: string'],
            ['acreditar(): void']),
        clase('retiro', 'Retiro', 620, 1680,
            ['canal: string'],
            ['validarSaldo(): boolean']),
        clase('transferencia', 'Transferencia', 1060, 1680,
            ['cuentaDestino: string', 'comision: decimal'],
            ['ejecutar(): boolean']),
        clase('sucursal', 'Sucursal', 1660, 320,
            ['id: int', 'nombre: string', 'direccion: string', 'ciudad: string'],
            ['cantidadEmpleados(): int']),
        clase('empleado', 'Empleado', 1660, 660,
            ['id: int', 'nombre: string', 'cargo: string', 'salario: decimal'],
            ['aprobarPrestamo(p: Prestamo): boolean'])
    ],
    edges: [
        rel('banco-natural-cliente', 'clienteNatural', 'cliente', 'Generalization'),
        rel('banco-empresa-cliente', 'clienteEmpresa', 'cliente', 'Generalization'),
        rel('banco-cliente-cuenta', 'cliente', 'cuenta', 'Association', '1', '*'),
        rel('banco-cliente-prestamo', 'cliente', 'prestamo', 'Association', '1', '*'),
        rel('banco-prestamo-cuota', 'prestamo', 'cuota', 'Composition', '1', '*'),
        rel('banco-cuenta-tarjeta', 'cuenta', 'tarjeta', 'Aggregation', '1', '*'),
        rel('banco-ahorro-cuenta', 'cuentaAhorro', 'cuenta', 'Generalization'),
        rel('banco-corriente-cuenta', 'cuentaCorriente', 'cuenta', 'Generalization'),
        rel('banco-cuenta-movimiento', 'cuenta', 'movimiento', 'Composition', '1', '*'),
        rel('banco-deposito-movimiento', 'deposito', 'movimiento', 'Generalization'),
        rel('banco-retiro-movimiento', 'retiro', 'movimiento', 'Generalization'),
        rel('banco-transferencia-movimiento', 'transferencia', 'movimiento', 'Generalization'),
        rel('banco-sucursal-empleado', 'sucursal', 'empleado', 'Composition', '1', '*'),
        rel('banco-sucursal-cuenta', 'sucursal', 'cuenta', 'Association', '1', '*'),
        rel('banco-empleado-prestamo', 'empleado', 'prestamo', 'Dependency', '', 'aprueba')
    ]
};

// ---------------------------------------------------------------- 6. Gimnasio (del diagrama del parcial)
// Las dos clases asociación del diagrama se escriben como clase con sus dos claves foráneas,
// que es en lo que se convierten al pasar al modelo lógico: Plan une Ejercicio con Objetivo
// ("conforma") y DetallePlan une Plan con Día ("distribuye").
const gimnasio = {
    titulo: 'Gimnasio',
    descripcion: 'Diagrama del parcial: entrenadores, clientes, planes y ejercicios (10 clases).',
    nodes: [
        clase('gym-entrenador', 'Entrenador', 460, 0,
            ['id: string', 'nombre: string', 'apellido: string', 'email: string', 'sexo: string', 'telefono: string'],
            ['emitirNotaVenta(): NotaVenta']),
        clase('gym-notaventa', 'NotaVenta', 900, 0,
            ['id: string', 'fecha: Date', 'total: float'],
            ['calcularTotal(): float']),
        clase('gym-cliente', 'Cliente', 1340, 0,
            ['id: string', 'ci: string', 'nombre: string', 'apellido: string', 'telefono: string',
                'sexo: string', 'edad: int', 'peso: float'],
            ['inscribirse(): void']),
        clase('gym-foto', 'Foto', 0, 340,
            ['id: string', 'url: string'], []),
        clase('gym-video', 'Video', 0, 640,
            ['id: string', 'url: string'], []),
        clase('gym-ejercicio', 'Ejercicio', 460, 400,
            ['id: string', 'nombre: string', 'descripcion: string'], []),
        clase('gym-objetivo', 'Objetivo', 900, 400,
            ['id: string', 'nombre: string', 'precio: float'], []),
        clase('gym-plan', 'Plan', 680, 760,
            ['id: string', 'nombre: string'], []),
        clase('gym-dia', 'Dia', 680, 1100,
            ['id: string', 'nombre: string'], []),
        clase('gym-detalleplan', 'DetallePlan', 1200, 930,
            ['id: int', 'series: int', 'repeticiones: int'], [])
    ],
    edges: [
        rel('gym-entrenador-notaventa', 'gym-entrenador', 'gym-notaventa', 'Association', '1', '1..*'),
        rel('gym-cliente-notaventa', 'gym-cliente', 'gym-notaventa', 'Association', '1', '1..*'),
        rel('gym-notaventa-objetivo', 'gym-notaventa', 'gym-objetivo', 'Association', '1', '1..*'),
        rel('gym-ejercicio-foto', 'gym-ejercicio', 'gym-foto', 'Composition', '1', '0..*'),
        rel('gym-ejercicio-video', 'gym-ejercicio', 'gym-video', 'Composition', '1', '0..*'),
        // "conforma": Ejercicio 1..* — 1..* Objetivo, con Plan como clase asociación
        rel('gym-ejercicio-plan', 'gym-ejercicio', 'gym-plan', 'Association', '1', '1..*'),
        rel('gym-objetivo-plan', 'gym-objetivo', 'gym-plan', 'Association', '1', '1..*'),
        // "distribuye": Plan 1..* — 1..* Día, con DetallePlan como clase asociación
        rel('gym-plan-detalleplan', 'gym-plan', 'gym-detalleplan', 'Association', '1', '1..*'),
        rel('gym-dia-detalleplan', 'gym-dia', 'gym-detalleplan', 'Association', '1', '1..*')
    ]
};

// ---------------------------------------------------------------- 7. Gimnasio con permisos
// El mismo diagrama con la clase Permisos: muestra cómo se limita cada rol. Sin esa clase
// (tablero anterior) todos los roles consultan todo y solo los de gestión modifican.
const gimnasioConPermisos = {
    titulo: 'Gimnasio con permisos',
    descripcion: 'El gimnasio con la clase Permisos: el cliente solo ve lo suyo y el entrenador lo de sus clientes.',
    nodes: [
        ...gimnasio.nodes.map((n) => ({ ...n, id: `perm-${n.id}` })),
        clase('perm-gym-permisos', 'Permisos', 1340, 760, [
            'CLIENTE: Cliente ver propios',
            'CLIENTE: NotaVenta ver propios',
            'CLIENTE: Objetivo ver propios',
            'CLIENTE: Plan ver propios',
            'CLIENTE: Ejercicio ver todos',
            'CLIENTE: Foto ver todos',
            'CLIENTE: Video ver todos',
            'ENTRENADOR: Entrenador ver propios',
            'ENTRENADOR: Cliente ver asignados',
            'ENTRENADOR: NotaVenta ver,crear,editar asignados',
            'ENTRENADOR: Objetivo ver,crear,editar asignados',
            'ENTRENADOR: Plan todo asignados',
            'ENTRENADOR: Ejercicio todo todos',
            'ENTRENADOR: Foto todo todos',
            'ENTRENADOR: Video todo todos',
            'ENTRENADOR: Dia todo todos',
            'ENTRENADOR: DetallePlan todo todos'
        ], [])
    ],
    edges: gimnasio.edges.map((e) => ({
        ...e,
        id: `perm-${e.id}`,
        source: `perm-${e.source}`,
        target: `perm-${e.target}`
    }))
};

// ---------------------------------------------------------------- 8. Historia clínica (caso del examen)
// Caso del enunciado: historia clínica electrónica fiscalizada, ficha de atención generada por
// una IA de triaje, atención por videoconferencia, exámenes digitalizados y certificados con
// cadena de bloques. El paciente solo ve su propia historia.
const salud = {
    titulo: 'Historia clínica electrónica',
    descripcion: 'Caso del examen: fichas con triaje por IA, teleconsulta, exámenes y certificados (13 clases).',
    nodes: [
        clase('salud-paciente', 'Paciente', 0, 0,
            ['id: int', 'ci: string', 'nombre: string', 'apellido: string', 'fechaNacimiento: Date',
                'sexo: string', 'telefono: string'],
            ['edad(): int']),
        clase('salud-historia', 'HistoriaClinica', 0, 380,
            ['id: int', 'fechaApertura: Date', 'observaciones: text'],
            ['resumen(): string']),
        clase('salud-ficha', 'FichaAtencion', 460, 0,
            ['id: int', 'fecha: DateTime', 'motivo: string', 'estado: string', 'modalidad: string'],
            ['anular(): void']),
        clase('salud-triaje', 'TriajeIA', 920, 0,
            ['id: int', 'fecha: DateTime', 'sintomas: text', 'urgencia: string', 'recomendacion: text'],
            ['requierePresencial(): boolean']),
        clase('salud-consulta', 'Consulta', 460, 380,
            ['id: int', 'fecha: DateTime', 'modalidad: string', 'diagnostico: text', 'tratamiento: text'],
            ['esTeleconsulta(): boolean']),
        clase('salud-medico', 'Medico', 920, 380,
            ['id: int', 'ci: string', 'nombre: string', 'apellido: string', 'especialidad: string', 'matricula: string'],
            ['atender(): Consulta']),
        clase('salud-centro', 'CentroMedico', 1380, 380,
            ['id: int', 'nombre: string', 'nivel: string', 'direccion: string', 'ciudad: string'], []),
        clase('salud-examen', 'Examen', 460, 760,
            ['id: int', 'fecha: DateTime', 'tipo: string', 'resultado: text'],
            ['estaListo(): boolean']),
        clase('salud-laboratorio', 'ExamenLaboratorio', 0, 1100,
            ['analito: string', 'valor: decimal', 'unidad: string', 'rangoReferencia: string'], []),
        clase('salud-imagen', 'EstudioImagen', 920, 1100,
            ['modalidad: string', 'archivoUrl: string', 'informe: text'], []),
        clase('salud-receta', 'Receta', 920, 760,
            ['id: int', 'fecha: Date', 'indicaciones: text'], []),
        clase('salud-medicamento', 'Medicamento', 1380, 760,
            ['id: int', 'nombre: string', 'concentracion: string', 'formaFarmaceutica: string'], []),
        clase('salud-certificado', 'Certificado', 1380, 0,
            ['id: int', 'tipo: string', 'fecha: DateTime', 'codigoVerificacion: string {unico}', 'hashBloque: string'],
            ['verificar(): boolean']),
        clase('salud-permisos', 'Permisos', 0, 760, [
            'PACIENTE: Paciente ver propios',
            'PACIENTE: HistoriaClinica ver propios',
            'PACIENTE: FichaAtencion ver,crear propios',
            'PACIENTE: TriajeIA ver propios',
            'PACIENTE: Consulta ver propios',
            'PACIENTE: Examen ver propios',
            'PACIENTE: ExamenLaboratorio ver propios',
            'PACIENTE: EstudioImagen ver propios',
            'PACIENTE: Receta ver propios',
            'PACIENTE: Certificado ver propios',
            'PACIENTE: CentroMedico ver todos',
            'MEDICO: Medico ver propios',
            'MEDICO: Paciente ver todos',
            'MEDICO: HistoriaClinica ver todos',
            'MEDICO: FichaAtencion ver,editar todos',
            'MEDICO: Consulta todo todos',
            'MEDICO: Examen todo todos',
            'MEDICO: Receta todo todos',
            'MEDICO: Certificado ver,crear todos',
            'MEDICO: Medicamento ver,crear todos',
            'MEDICO: TriajeIA ver todos',
            'MEDICO: ExamenLaboratorio todo todos',
            'MEDICO: EstudioImagen todo todos',
            'MEDICO: CentroMedico ver todos'
        ], [])
    ],
    edges: [
        // La historia clínica es el centro del caso: todo lo del paciente cuelga de ella, y así
        // cada registro tiene un único camino hasta su dueño (lo que exige la política de permisos).
        rel('salud-paciente-historia', 'salud-paciente', 'salud-historia', 'Composition', '1', '1'),
        rel('salud-historia-ficha', 'salud-historia', 'salud-ficha', 'Aggregation', '1', '*'),
        rel('salud-ficha-triaje', 'salud-ficha', 'salud-triaje', 'Composition', '1', '1'),
        rel('salud-ficha-consulta', 'salud-ficha', 'salud-consulta', 'Association', '1', '1'),
        rel('salud-medico-consulta', 'salud-medico', 'salud-consulta', 'Association', '1', '*'),
        rel('salud-centro-medico', 'salud-centro', 'salud-medico', 'Association', '1', '*'),
        rel('salud-centro-ficha', 'salud-centro', 'salud-ficha', 'Association', '1', '*'),
        rel('salud-consulta-examen', 'salud-consulta', 'salud-examen', 'Association', '1', '*'),
        rel('salud-examen-laboratorio', 'salud-laboratorio', 'salud-examen', 'Generalization'),
        rel('salud-examen-imagen', 'salud-imagen', 'salud-examen', 'Generalization'),
        rel('salud-consulta-receta', 'salud-consulta', 'salud-receta', 'Composition', '1', '*'),
        rel('salud-receta-medicamento', 'salud-receta', 'salud-medicamento', 'Association', '*', '*'),
        rel('salud-consulta-certificado', 'salud-consulta', 'salud-certificado', 'Association', '1', '*')
    ]
};

export const TABLEROS_PRUEBA = [tienda, biblioteca, clinica, academico, banco, gimnasio, gimnasioConPermisos, salud];

/**
 * Deja las cuentas de prueba con exactamente estos tableros: restaura su contenido y borra los
 * tableros extra que se hayan creado mientras se probaba.
 */
export const asegurarTablerosPrueba = async (idPropietario, idInvitado) => {
    const ids = [];
    for (const tablero of TABLEROS_PRUEBA) {
        const xml = JSON.stringify({ nodes: tablero.nodes, edges: tablero.edges });
        const { rows } = await pool.query(
            'SELECT id FROM "Salas" WHERE userid = $1 AND title = $2 ORDER BY id LIMIT 1',
            [idPropietario, tablero.titulo]
        );
        let id;
        if (rows.length) {
            id = rows[0].id;
            await pool.query(
                `UPDATE "Salas" SET xml = $2, description = $3, eliminar = false, updatedat = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [id, xml, tablero.descripcion]
            );
        } else {
            const creado = await pool.query(
                'INSERT INTO "Salas" (title, xml, description, userid) VALUES ($1, $2, $3, $4) RETURNING id',
                [tablero.titulo, xml, tablero.descripcion, idPropietario]
            );
            id = creado.rows[0].id;
        }
        // La otra cuenta de prueba queda invitada para probar la edición conjunta
        await pool.query(
            'INSERT INTO "Usersala" (userid, salas_id) VALUES ($1, $2) ON CONFLICT (userid, salas_id) DO NOTHING',
            [idInvitado, id]
        );
        ids.push(id);
    }

    // Los demás tableros de esas cuentas se conservan: antes se borraban en cada arranque
    // y un reinicio de desarrollo se llevaba el trabajo hecho con la cuenta de prueba.
    const { rows: propios } = await pool.query(
        'SELECT count(*)::int AS total FROM "Salas" WHERE userid = ANY($1) AND NOT (id = ANY($2)) AND eliminar = false',
        [[idPropietario, idInvitado], ids]
    );
    return { restaurados: ids.length, conservados: propios[0].total };
};
