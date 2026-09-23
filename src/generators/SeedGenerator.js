/**
 * Datos de ejemplo en el proyecto generado.
 *
 * Un prototipo con todas las listas vacías no se puede mostrar a nadie: no se ve cómo queda una
 * tabla ni cómo se relacionan las clases del diagrama. Al arrancar, la clase que genera este
 * archivo siembra unos pocos registros por cada clase, en el orden que imponen las relaciones
 * (primero aquello de lo que dependen las demás).
 *
 * Solo siembra cuando la base está vacía, así lo que se cargue después no se pisa. Con
 * app.demo.reiniciar=true borra y vuelve a sembrar en cada arranque, para demostraciones.
 */
import EntityGenerator from './EntityGenerator.js';

/** Cuántos registros por clase. Tres alcanzan para ver una lista y para relacionarlos entre sí. */
const CANTIDAD = 3;

const sinTildes = (texto) => String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_]/g, '');

const capitalizar = (texto) => String(texto).charAt(0).toUpperCase() + String(texto).slice(1);

/** Igual que en EntityGenerator: los setters tienen que coincidir carácter por carácter. */
const aCamel = (texto) => {
    const str = String(texto);
    if (str.includes('_')) {
        return str.split('_')
            .map((palabra, i) => (i === 0 ? palabra.toLowerCase() : capitalizar(palabra.toLowerCase())))
            .join('');
    }
    return str.charAt(0).toLowerCase() + str.slice(1);
};

/** Nombre de variable Java sin tildes (el tipo sí las conserva: Día dia1 = new Día()). */
const variableDe = (nombre) => {
    const limpio = sinTildes(nombre) || 'dato';
    const inicial = limpio.charAt(0).toLowerCase() + limpio.slice(1);
    return /^[0-9]/.test(inicial) ? `r${inicial}` : inicial;
};

const textoJava = (valor) => `"${String(valor).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const NOMBRES = ['Ana', 'Luis', 'Marta', 'Carlos', 'Sofía'];
const APELLIDOS = ['Gómez', 'Pérez', 'Rojas', 'Vargas', 'Salazar'];
const CORREOS = ['ana@demo.com', 'luis@demo.com', 'marta@demo.com', 'carlos@demo.com', 'sofia@demo.com'];
const TELEFONOS = ['70011223', '71122334', '72233445', '73344556', '74455667'];
const DOCUMENTOS = ['1234567', '2345678', '3456789', '4567890', '5678901'];
const DIRECCIONES = ['Av. Ejemplo 123', 'Calle Demo 456', 'Av. Prueba 789', 'Calle Modelo 101', 'Av. Central 202'];
const ESTADOS = ['ACTIVO', 'PENDIENTE', 'FINALIZADO', 'ACTIVO', 'PENDIENTE'];
const SEXOS = ['F', 'M', 'F', 'M', 'F'];

const incluye = (nombre, ...claves) => claves.some((clave) => nombre.includes(clave));
const esCampo = (nombre, ...claves) => claves.some((clave) => nombre === clave);

/** ¿La clase representa a una persona? Cambia los textos: "Ana" en vez de "Cliente 1". */
const pareceDePersona = (entidad) => {
    const campos = (entidad.attributes || []).map((a) => sinTildes(a.name).toLowerCase());
    return campos.some((c) => incluye(c, 'apellido', 'edad', 'sexo', 'genero', 'nacimiento'))
        || esCampo(String(entidad.name).toLowerCase(), 'persona', 'cliente', 'usuario', 'empleado', 'paciente', 'alumno');
};

const textoPara = (campo, i, contexto) => {
    if (incluye(campo, 'email', 'correo')) return CORREOS[i % CORREOS.length];
    if (incluye(campo, 'telefono', 'celular', 'movil', 'phone', 'whatsapp')) return TELEFONOS[i % TELEFONOS.length];
    if (incluye(campo, 'apellido', 'lastname')) return APELLIDOS[i % APELLIDOS.length];
    if (esCampo(campo, 'ci', 'dni', 'nit', 'cedula', 'documento', 'carnet')) return DOCUMENTOS[i % DOCUMENTOS.length];
    if (incluye(campo, 'direccion', 'domicilio', 'address', 'ubicacion')) return DIRECCIONES[i % DIRECCIONES.length];
    if (incluye(campo, 'sexo', 'genero')) return SEXOS[i % SEXOS.length];
    if (incluye(campo, 'estado', 'status', 'situacion')) return ESTADOS[i % ESTADOS.length];
    if (incluye(campo, 'descripcion', 'detalle', 'observacion', 'comentario', 'resumen')) {
        return `${contexto.entidad} de ejemplo ${i + 1}`;
    }
    if (incluye(campo, 'url', 'imagen', 'foto', 'video', 'archivo', 'enlace', 'link', 'adjunto')) {
        // La extensión sale del campo o de la clase: Vídeo.url es un mp4, Foto.url un jpg
        const esVideo = incluye(campo, 'video') || incluye(contexto.archivo, 'video', 'clip', 'pelicula');
        return `https://ejemplo.com/${contexto.archivo}-${i + 1}.${esVideo ? 'mp4' : 'jpg'}`;
    }
    if (incluye(campo, 'codigo', 'clave', 'sku', 'matricula', 'placa', 'serie')) {
        return `${contexto.prefijo}-00${i + 1}`;
    }
    if (incluye(campo, 'nombre', 'name', 'titulo', 'title', 'razon')) {
        return contexto.persona ? NOMBRES[i % NOMBRES.length] : `${contexto.entidad} ${i + 1}`;
    }
    return `${capitalizar(campo)} ${i + 1}`;
};

const enteroPara = (campo, i) => {
    if (incluye(campo, 'edad')) return [25, 31, 42, 28, 35][i % 5];
    if (incluye(campo, 'repeticion')) return [10, 12, 15, 8, 20][i % 5];
    if (incluye(campo, 'serie', 'set')) return [3, 4, 5, 3, 4][i % 5];
    if (incluye(campo, 'cantidad', 'stock', 'existencia', 'unidades')) return [5, 10, 20, 15, 8][i % 5];
    if (incluye(campo, 'anio', 'year', 'gestion')) return 2024 + i;
    if (incluye(campo, 'duracion', 'minutos', 'tiempo')) return [30, 45, 60, 20, 90][i % 5];
    return i + 1;
};

const decimalPara = (campo, i) => {
    if (incluye(campo, 'precio', 'total', 'monto', 'costo', 'importe', 'pago', 'salario', 'sueldo', 'tarifa')) {
        return ['150.00', '220.50', '99.90', '340.00', '75.25'][i % 5];
    }
    if (incluye(campo, 'peso')) return ['68.5', '74.0', '60.2', '81.3', '55.7'][i % 5];
    if (incluye(campo, 'altura', 'estatura', 'talla')) return ['1.70', '1.82', '1.65', '1.78', '1.60'][i % 5];
    if (incluye(campo, 'porcentaje', 'descuento', 'interes')) return ['10.0', '15.5', '5.0', '20.0', '7.5'][i % 5];
    if (incluye(campo, 'latitud')) return ['-17.783', '-17.790', '-17.775', '-17.801', '-17.768'][i % 5];
    if (incluye(campo, 'longitud')) return ['-63.182', '-63.175', '-63.190', '-63.166', '-63.199'][i % 5];
    return `${(i + 1) * 10}.50`;
};

const fechaPara = (campo, i) => {
    if (incluye(campo, 'nacimiento')) return `LocalDate.now().minusYears(${25 + i * 5})`;
    if (incluye(campo, 'vencimiento', 'entrega', 'limite', 'caducidad')) {
        return `LocalDate.now().plusDays(${(i + 1) * 15})`;
    }
    return `LocalDate.now().minusDays(${(i + 1) * 7})`;
};

/**
 * Recorta el texto al largo que declara la columna: la entidad lleva @Size(max = N) y un
 * varchar(10) rechazaría "Descripción de ejemplo 1" al arrancar.
 */
const recortar = (texto, attr) => {
    const sql = String(attr.sqlType || '');
    if (/^TEXT$/i.test(sql)) return texto;
    const largo = Number((sql.match(/\d+/) || [255])[0]);
    return texto.length > largo ? texto.slice(0, largo) : texto;
};

/** Valor de ejemplo para un campo suelto. Devuelve null si el tipo no se sabe sembrar. */
const valorLiteral = (attr, tipoJava, i, contexto) => {
    const campo = sinTildes(attr.name).toLowerCase();
    switch (tipoJava) {
        case 'String': return textoJava(recortar(textoPara(campo, i, contexto), attr));
        case 'Integer': return String(enteroPara(campo, i));
        case 'Long': return `${enteroPara(campo, i)}L`;
        case 'Double': return decimalPara(campo, i);
        case 'Float': return `${decimalPara(campo, i)}f`;
        case 'BigDecimal': return `new BigDecimal("${decimalPara(campo, i)}")`;
        case 'Boolean': return i % 3 === 2 ? 'false' : 'true';
        case 'LocalDate': return fechaPara(campo, i);
        case 'LocalDateTime': return `LocalDateTime.now().minusDays(${i + 1})`;
        case 'LocalTime': return `LocalTime.of(${8 + i}, 30)`;
        default: return null;
    }
};

/** Prefijo corto y legible para las claves de texto: Cliente -> CLI-1, NotaVenta -> NOT-1. */
const prefijoDe = (nombre) => (sinTildes(nombre).toUpperCase().slice(0, 3) || 'REG');

/**
 * Orden de siembra: una clase va después de aquellas a las que apunta con una clave foránea.
 * Si el diagrama tiene un ciclo, se corta y la referencia que falte queda en blanco.
 */
const ordenarPorDependencias = (entidades) => {
    const porNombre = new Map(entidades.map((e) => [e.name, e]));
    const visitadas = new Set();
    const enCurso = new Set();
    const orden = [];
    const visitar = (entidad) => {
        if (visitadas.has(entidad.name) || enCurso.has(entidad.name)) return;
        enCurso.add(entidad.name);
        (entidad.attributes || [])
            .filter((a) => a.isForeignKey && a.referencedEntity && a.referencedEntity !== entidad.name)
            .forEach((a) => {
                const referida = porNombre.get(a.referencedEntity);
                if (referida) visitar(referida);
            });
        enCurso.delete(entidad.name);
        visitadas.add(entidad.name);
        orden.push(entidad);
    };
    entidades.forEach(visitar);
    return orden;
};

/**
 * Atributos de la clase más los que hereda, sin repetir.
 *
 * En una herencia el hijo usa los setters del padre: si no se llenan, los campos obligatorios
 * del padre (nombre, correo, teléfono…) quedan nulos y la siembra revienta al guardar.
 */
const atributosConHerencia = (generador, entidad) => {
    const cadena = [entidad];
    let actual = entidad;
    while (actual && generador.isChildInInheritance(actual.id)) {
        const padre = generador.getParentEntity(actual.id);
        if (!padre || cadena.includes(padre)) break;
        cadena.push(padre);
        actual = padre;
    }
    const vistos = new Set();
    const acumulado = [];
    cadena.forEach((clase) => {
        (clase.attributes || []).forEach((attr) => {
            const nombre = String(attr.name || '').toLowerCase();
            if (vistos.has(nombre)) return;
            vistos.add(nombre);
            acumulado.push(attr);
        });
    });
    return acumulado;
};

const claveDe = (entidad) => (entidad.attributes || []).find((a) => a.isPrimaryKey) || null;

/** Clases que sí se pueden sembrar: con una sola clave propia y sin herencia de por medio. */
const esSembrable = (entidad) => {
    const claves = (entidad.attributes || []).filter((a) => a.isPrimaryKey);
    return claves.length === 1 && !claves[0].isForeignKey;
};

export const datosDemo = (nombreApp, entidades, relaciones = []) => {
    const sembrables = (entidades || []).filter(esSembrable);
    const generador = new EntityGenerator(entidades, relaciones);
    const orden = ordenarPorDependencias(sembrables);
    const listaDe = new Map();      // nombre de clase -> variable con la lista ya guardada
    const repositorios = [];        // [{ tipo, variable }]
    const bloques = [];
    const enlaces = [];
    const tiposUsados = new Set();

    orden.forEach((entidad) => {
        const clase = entidad.name;
        const base = variableDe(clase);
        const repo = `${base}Repository`;
        repositorios.push({ tipo: `${clase}Repository`, variable: repo });
        const clave = claveDe(entidad);
        const tipoClave = generador.mapTypeToJava(clave ? clave.type : 'Long');
        const claveEsTexto = tipoClave === 'String';
        const contexto = {
            entidad: clase,
            persona: pareceDePersona(entidad),
            prefijo: prefijoDe(clase),
            archivo: sinTildes(clase).toLowerCase()
        };
        // Con herencia hay que llenar también lo del padre: Estudiante hereda de Persona el
        // nombre y el correo, que son obligatorios, y sin ellos el arranque falla.
        const heredados = atributosConHerencia(generador, entidad);
        const propios = heredados.filter((a) => !a.isPrimaryKey && !a.isForeignKey);
        const foraneos = heredados
            .filter((a) => a.isForeignKey && a.referencedEntity && listaDe.has(a.referencedEntity));

        const objetos = [];
        const lineas = [];
        for (let i = 0; i < CANTIDAD; i += 1) {
            const objeto = `${base}${i + 1}`;
            objetos.push(objeto);
            lineas.push(`        ${clase} ${objeto} = new ${clase}();`);
            if (claveEsTexto) {
                const valorClave = textoJava(`${contexto.prefijo}-${i + 1}`);
                lineas.push(`        ${objeto}.set${capitalizar(aCamel(clave.name))}(${valorClave});`);
            }
            propios.forEach((attr) => {
                const tipo = generador.mapTypeToJava(attr.type);
                const valor = valorLiteral(attr, tipo, i, contexto);
                if (valor === null) return;
                tiposUsados.add(tipo);
                lineas.push(`        ${objeto}.set${capitalizar(aCamel(attr.name))}(${valor});`);
            });
            foraneos.forEach((attr) => {
                const lista = listaDe.get(attr.referencedEntity);
                lineas.push(`        ${objeto}.set${capitalizar(aCamel(attr.name))}(${lista}.get(${i} % ${lista}.size()));`);
            });
            lineas.push('');
        }
        const listaVar = `${base}s`;
        listaDe.set(clase, listaVar);
        lineas.push(`        List<${clase}> ${listaVar} = ${repo}.saveAll(List.of(${objetos.join(', ')}));`);
        lineas.push(`        System.out.println("   - ${clase}: " + ${listaVar}.size());`);
        bloques.push(lineas.join('\n'));
    });

    // Muchos a muchos: se enlaza al final, cuando ya existen las dos partes de la relación.
    // Solo el lado dueño de la tabla intermedia escribe; el otro es el reflejo.
    orden.forEach((entidad) => {
        const lista = listaDe.get(entidad.name);
        const repo = `${variableDe(entidad.name)}Repository`;
        generador.getManyToManyRelationships(entidad)
            .filter((r) => r.isOwner && listaDe.has(r.relatedEntity.name))
            .forEach(({ relatedEntity }) => {
                const otra = listaDe.get(relatedEntity.name);
                const campo = capitalizar(`${aCamel(relatedEntity.name)}s`);
                enlaces.push([
                    '        {',
                    `            for (int i = 0; i < ${lista}.size() && !${otra}.isEmpty(); i++) {`,
                    `                List<${relatedEntity.name}> relacionados = new ArrayList<>();`,
                    `                relacionados.add(${otra}.get(i % ${otra}.size()));`,
                    `                if (${otra}.size() > 1) relacionados.add(${otra}.get((i + 1) % ${otra}.size()));`,
                    `                ${lista}.get(i).set${campo}(relacionados);`,
                    '            }',
                    `            ${repo}.saveAll(${lista});`,
                    `            System.out.println("   - ${entidad.name} y ${relatedEntity.name}: relacionados");`,
                    '        }'
                ].join('\n'));
            });
    });

    const imports = [
        'import com.example.demo.entities.*;',
        'import com.example.demo.repositories.*;',
        'import org.springframework.beans.factory.annotation.Value;',
        'import org.springframework.boot.CommandLineRunner;',
        'import org.springframework.core.annotation.Order;',
        'import org.springframework.stereotype.Component;',
        'import org.springframework.transaction.annotation.Transactional;',
        '',
        tiposUsados.has('BigDecimal') ? 'import java.math.BigDecimal;' : '',
        tiposUsados.has('LocalDate') ? 'import java.time.LocalDate;' : '',
        tiposUsados.has('LocalDateTime') ? 'import java.time.LocalDateTime;' : '',
        tiposUsados.has('LocalTime') ? 'import java.time.LocalTime;' : '',
        'import java.util.ArrayList;',
        'import java.util.List;'
    ].filter(Boolean).join('\n');

    const campos = repositorios.map((r) => `    private final ${r.tipo} ${r.variable};`).join('\n');
    const parametros = repositorios.map((r) => `${r.tipo} ${r.variable}`).join(', ');
    const asignaciones = repositorios.map((r) => `        this.${r.variable} = ${r.variable};`).join('\n');
    const cuentas = repositorios.map((r) => `${r.variable}.count()`).join(' + ') || '0';
    const borrados = [...repositorios].reverse().map((r) => `        ${r.variable}.deleteAll();`).join('\n');

    return `package com.example.demo.config;

${imports}

/**
 * Datos de ejemplo de ${nombreApp}.
 *
 * Al arrancar con la base vacía deja unos registros de muestra en cada tabla, relacionados entre
 * sí como manda el diagrama, para que el sistema y la app móvil se puedan mostrar con algo
 * dentro. No toca nada si ya hay información guardada.
 *
 * En application.properties:
 *   app.demo.datos=true       siembra cuando la base está vacía (por defecto)
 *   app.demo.reiniciar=true   borra y vuelve a sembrar en cada arranque (para demostraciones)
 */
@Component
@Order(20)
public class DatosDemo implements CommandLineRunner {

${campos}

    @Value("\${app.demo.datos:true}")
    private boolean sembrar;

    @Value("\${app.demo.reiniciar:false}")
    private boolean reiniciar;

    public DatosDemo(${parametros}) {
${asignaciones}
    }

    @Override
    @Transactional
    public void run(String... args) {
        if (!sembrar) return;
        if (reiniciar) {
            borrarTodo();
            System.out.println("Datos de ejemplo: se borró lo anterior (app.demo.reiniciar=true)");
        } else if (hayDatos()) {
            System.out.println("Datos de ejemplo: la base ya tiene registros, no se toca nada");
            return;
        }
        System.out.println("Datos de ejemplo de ${nombreApp}:");
        sembrarTodo();
        System.out.println("Listo: el sistema ya tiene con qué mostrarse.");
    }

    private boolean hayDatos() {
        return ${cuentas} > 0;
    }

    private void borrarTodo() {
${borrados}
    }

    private void sembrarTodo() {
${[...bloques, ...enlaces].join('\n\n')}
    }
}
`;
};

/** Bloque que se agrega a application.properties. */
export const propiedadesDemo = () => `
# ===================================================================
# DATOS DE EJEMPLO
# Al arrancar con la base vacía se siembran unos registros por tabla para que el
# prototipo se pueda mostrar. Con reiniciar=true se borran y se vuelven a crear
# en cada arranque; en false (por defecto) se respeta lo que ya esté guardado.
# ===================================================================
app.demo.datos=true
app.demo.reiniciar=false
`;
