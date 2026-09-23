import { restriccionesDe } from '../generators/RestriccionesUML.js';
import { extraerPermisos } from '../generators/Permisos.js';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { response } from '../middlewares/catchedAsync.js';
import { getSalaById } from '../models/sala.model.js';
import { rm } from 'fs/promises';
import SpringBootProjectBuilder from '../generators/SpringBootProjectBuilder.js';
import SqlDDLGenerator from '../generators/SqlDDLGenerator.js';
import os from 'os';
import { puedeAccederASala } from '../libs/salaAccess.js';
import { describirProyecto } from '../libs/descripcionProyecto.js';

// Portable: configurable por env, con fallback al tmp del sistema (funciona en Windows y Linux)
const rutaBase = process.env.EXPORT_TMP_DIR || path.join(os.tmpdir(), 'proyectos');
fs.mkdirSync(rutaBase, { recursive: true });

// Saneo del nombre de proyecto: el titulo del tablero lo escribe el usuario y
// termina en una ruta del sistema de archivos. Sin esto, un titulo con '..' o '/'
// escapa del directorio temporal (se escribe y se BORRA recursivamente ahi).
export const sanitizarNombreProyecto = (titulo) => {
  const limpio = String(titulo || 'project')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return limpio || 'project';
};

// Nombre de la base PostgreSQL de un tablero. Es el mismo en el proyecto Spring
// Boot (application.properties, README) y en el script SQL: antes el ZIP usaba
// "spring_boot_<tablero>" y el script "<tablero>", y la base creada con uno no
// servia para el otro.
export const nombreBaseDatos = (titulo) => {
  const nombre = sanitizarNombreProyecto(titulo).replace(/-/g, '_');
  // Un identificador de PostgreSQL sin comillas no puede empezar por un digito
  return /^[0-9]/.test(nombre) ? `db_${nombre}` : nombre;
};

// Defensa en profundidad: nunca operar fuera de rutaBase aunque el saneo falle.
export const resolverDentroDeBase = (nombre) => {
  const base = path.resolve(rutaBase);
  const destino = path.resolve(base, nombre);
  if (destino !== base && !destino.startsWith(base + path.sep)) {
    throw new Error('Ruta de proyecto invalida');
  }
  return destino;
};

class CrearPaginaController {
  comprimirProyecto = async (titulo) => {
    const rutaFinal = resolverDentroDeBase(titulo);
    const zipPath = resolverDentroDeBase(`${titulo}.zip`);
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));
      archive.pipe(output);
      archive.directory(rutaFinal, false);
      archive.finalize();
    });
  };

  enviarZip = async (res, titulo, nombreDescarga = `${sanitizarNombreProyecto(titulo)}.zip`) => {
    const rutaFinal = resolverDentroDeBase(titulo);
    const zipPath = resolverDentroDeBase(`${titulo}.zip`);
    try {
      const zipBuffer = fs.readFileSync(zipPath);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${nombreDescarga}"`);
      res.send(zipBuffer);
      await rm(rutaFinal, { recursive: true, force: true });
      await rm(zipPath, { force: true });
    } catch (error) {
      console.error('❌ Error al enviar o limpiar:', error.message);
      throw error;
    }
  };

  convertirFrontendADiagramParser = (elements, connections = [], permisosCrudos = null) => {
    const politica = extraerPermisos(elements, connections, permisosCrudos);
    const convertedElements = {};
    politica.elementos.forEach(node => {
      // Accept frontend nodes which may use 'classNode' and store data under node.data
      const isClassLike = node.type === 'class' || node.type === 'classNode' || (node.data && node.data.className);
      if (isClassLike) {
        const rawAttributes = (node.attributes && node.attributes.length) ? node.attributes : (node.data && node.data.attributes) ? node.data.attributes : [];
        const rawMethods = (node.methods && node.methods.length) ? node.methods : (node.data && node.data.methods) ? node.data.methods : [];
        const processedAttributes = (rawAttributes || []).map(attr => {
          if (typeof attr === 'string') {
            // Notacion UML 2.5: [+|-|#|~] nombre: Tipo [= valor]
            const { limpio: bruto, reglas } = restriccionesDe(attr);
            const simbolo = (bruto.match(/^([+\-#~])/) || [])[1];
            const visibility = this.getVisibilityFromSymbol(simbolo || '-');
            let cuerpo = bruto.replace(/^([+\-#~])?\s*/, '');
            let defaultValue = null;
            const igual = cuerpo.indexOf('=');
            if (igual !== -1) {
              defaultValue = cuerpo.slice(igual + 1).trim() || null;
              cuerpo = cuerpo.slice(0, igual).trim();
            }
            const parts = cuerpo.split(':').map(s => s.trim());
            const name = parts[0] || 'field';
            const esClave = name.toLowerCase() === 'id';
            // Normalizar el tipo al catalogo que entiende EntityGenerator
            // (antes se pasaba crudo: "double" -> no reconocido -> String).
            // Un "id" sin tipo en el diagrama es la clave numérica que genera la base: si se
            // dejaba en String, la entidad quedaba sin @GeneratedValue y no se podía crear nada.
            const tipoDiagrama = parts[1] || (esClave ? 'Long' : 'String');
            const type = this.mapJavaType(tipoDiagrama);
            // text y geometrías -> TEXT, char -> VARCHAR(1): columna y validación lo respetan
            const sqlType = this.sqlTypeDe(tipoDiagrama);
            return { name, type, sqlType, visibility, defaultValue, isPrimaryKey: esClave, ...reglas };
          }
          const nombreLimpio = restriccionesDe(attr.name);
          const tipoLimpio = restriccionesDe(attr.type);
          const { reglas } = restriccionesDe(`${attr.name || ''} ${attr.type || ''}`);
          const esClavePrimaria = attr.isPrimaryKey === true || nombreLimpio.limpio.toLowerCase() === 'id';
          return {
            ...reglas,
            ...Object.fromEntries(['obligatorio', 'unico', 'minimo', 'maximo', 'etiqueta', 'oculto', 'orden', 'principal'].filter(k => attr[k] !== undefined).map(k => [k, attr[k]])),
            name: nombreLimpio.limpio || 'field',
            // Un id sin tipo es la clave numérica que genera la base de datos
            type: this.mapJavaType(tipoLimpio.limpio || (esClavePrimaria ? 'Long' : 'String')),
            sqlType: attr.sqlType || this.sqlTypeDe(tipoLimpio.limpio),
            defaultValue: attr.defaultValue,
            visibility: attr.visibility || 'private',
            isStatic: attr.isStatic || false,
            isPrimaryKey: esClavePrimaria,
            isForeignKey: false,
            referencedEntity: attr.referencedEntity,
            referencedField: attr.referencedField,
            referencedType: attr.referencedType
          };
        });

        const hasPK = processedAttributes.some(a => a.isPrimaryKey);
        if (!hasPK) {
          processedAttributes.unshift({ name: 'id', type: 'Long', sqlType: 'BIGINT', visibility: 'private', isPrimaryKey: true, isForeignKey: false });
        }

        const resolvedName = node.name || (node.data && node.data.className) || 'Entity';

        convertedElements[node.id] = {
          id: node.id,
          name: resolvedName,
          type: 'class',
          attributes: processedAttributes,
          methods: rawMethods || [],
          stereotype: node.stereotype || (node.data && node.data.stereotype) || null,
          isAbstract: (node.data && node.data.stereotype) === 'abstract',
          visibility: node.visibility || 'public',
          description: node.description || (node.data && node.data.description) || ''
        };
      }
    });

    const convertedConnections = {};
    politica.conexiones.forEach((edge, idx) => {
      if (!edge.source || !edge.target) return;
      if (!convertedElements[edge.source] || !convertedElements[edge.target]) return;
      const d = edge.data || {};

      // Ignorar conexiones internas de la UI (linea punteada de clase de asociacion,
      // conectores de notas): no son relaciones UML del modelo.
      if (d.isAssociationConnection || d.isNoteConnection) return;

      convertedConnections[`conn_${idx}`] = {
        id: `conn_${idx}`,
        type: this.mapTipoRelacion(d.type || edge.type),
        source: edge.source,
        target: edge.target,
        sourceMultiplicity: edge.sourceMultiplicity || d.startLabel || '1',
        targetMultiplicity: edge.targetMultiplicity || d.endLabel || '1',
        sourceName: edge.sourceName || d.sourceRole || '',
        targetName: edge.targetName || d.targetRole || '',
        description: edge.description || d.label || ''
      };
    });

    // MAPEO OO -> RELACIONAL: el usuario dibuja clases y una linea entre ellas,
    // pero el generador JPA espera que la entidad del lado "muchos" ya tenga un
    // atributo clave foranea. Aqui derivamos esas FK desde las cardinalidades.
    this.derivarClavesForaneas(convertedElements, convertedConnections);
    this.alinearClavesDeHerencia(convertedElements, convertedConnections);

    return { elements: convertedElements, connections: convertedConnections, permisos: politica.permisosCrudos };
  };

  // Inserta atributos FK segun la cardinalidad de cada relacion:
  //   1 --> *   la entidad del lado "muchos" recibe la FK
  //   * --> *   se marca como many-to-many (tabla intermedia, sin FK simple)
  //   1 --> 1   la FK va en el destino por convencion
  // La herencia no genera FK (se resuelve con estrategias de herencia JPA).
  // Si varias relaciones unen las mismas dos clases (p. ej. "origen" y "destino"
  // de paradas a RedAristas), cada una lleva su propia FK con el nombre de su rol
  // o de su etiqueta; antes solo se creaba la primera y las demas se perdian.
  /**
   * En una herencia JPA (JOINED) el hijo comparte la clave del padre: Docente usa el "id" de
   * Persona. Si el hijo no dibujaba su propio "id" se le ponía uno numérico por defecto, y
   * cuando el padre usaba otro tipo (int o texto) el proyecto no compilaba, porque el setter
   * heredado recibía un long. Aquí la clave del hijo se iguala a la del padre.
   */
  alinearClavesDeHerencia = (elements, connections) => {
    const padreDe = new Map();
    Object.values(connections).forEach((conn) => {
      // La flecha de una generalización va del hijo (source) al padre (target)
      if (conn.type === 'inheritance') padreDe.set(conn.source, conn.target);
    });
    const claveDe = (id, vistos = new Set()) => {
      if (!id || vistos.has(id)) return null;
      vistos.add(id);
      const heredada = claveDe(padreDe.get(id), vistos);
      if (heredada) return heredada;
      return ((elements[id] || {}).attributes || []).find(a => a.isPrimaryKey) || null;
    };
    padreDe.forEach((padreId, hijoId) => {
      const delPadre = claveDe(padreId);
      const delHijo = ((elements[hijoId] || {}).attributes || []).find(a => a.isPrimaryKey);
      if (!delPadre || !delHijo) return;
      delHijo.name = delPadre.name;
      delHijo.type = delPadre.type;
      delHijo.sqlType = delPadre.sqlType || delHijo.sqlType;
    });
  };

  derivarClavesForaneas = (elements, connections) => {
    const esMuchos = (m) => typeof m === 'string' && m.includes('*');
    const grupos = new Map();

    Object.values(connections).forEach(conn => {
      if (conn.type === 'inheritance') {
        // Realizar una interfaz (o heredar de una enumeracion) no es herencia JPA:
        // no son tablas. Antes la clase quedaba como "hija" sin padre real, perdia
        // su id y el proyecto no compilaba.
        const extremos = [elements[conn.source], elements[conn.target]];
        if (extremos.some(e => e && (e.stereotype === 'interface' || e.stereotype === 'enumeration'))) {
          conn.type = 'implementation';
          return;
        }
        // Una generalizacion UML no lleva cardinalidades, pero EntityGenerator
        // identifica al hijo por multiplicidad '*' y al padre por '1'. La flecha
        // va del hijo (source) al padre (target), asi que normalizamos aqui para
        // que se genere el "extends" (antes la herencia se perdia por completo).
        conn.sourceMultiplicity = '*';
        conn.targetMultiplicity = '1';
        return;
      }

      const origen = elements[conn.source];
      const destino = elements[conn.target];
      if (!origen || !destino) return;

      // Interfaces y enumeraciones no son tablas: una relacion hacia ellas no
      // debe generar una clave foranea a una entidad que no existe en la BD.
      const esAuxiliar = (e) => e.stereotype === 'interface' || e.stereotype === 'enumeration';
      if (esAuxiliar(origen) || esAuxiliar(destino)) return;

      const origenMuchos = esMuchos(conn.sourceMultiplicity);
      const destinoMuchos = esMuchos(conn.targetMultiplicity);

      // Muchos a muchos: lo marcamos para que el generador use tabla intermedia
      if (origenMuchos && destinoMuchos) {
        conn.type = 'many-to-many-direct';
        return;
      }

      // El lado "muchos" es quien lleva la FK; si no hay lado muchos (1:1),
      // la FK va en el destino.
      const entidadConFK = origenMuchos ? origen : destino;
      const entidadReferenciada = origenMuchos ? destino : origen;

      const par = `${entidadConFK.id}->${entidadReferenciada.id}`;
      if (!grupos.has(par)) grupos.set(par, []);
      grupos.get(par).push({ conn, entidadConFK, entidadReferenciada });
    });

    // Nombre del campo y columna tal como los generan EntityGenerator y SqlDDLGenerator
    const campo = (s) => String(s).includes('_')
      ? String(s).split('_').map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())).join('')
      : String(s).charAt(0).toLowerCase() + String(s).slice(1);
    const snake = (s) => String(s).replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    const columnaDe = (a) => {
      const base = snake(a.name);
      return a.isForeignKey && !base.endsWith('_id') ? `${base}_id` : base;
    };

    grupos.forEach(grupo => {
      grupo.forEach(({ conn, entidadConFK, entidadReferenciada }, indice) => {
        // Nombre en camelCase de la entidad referenciada (sin sufijo "Id"): el
        // generador de DTO ya anade "Id" al exponerla en el JSON de la API.
        const base = `${entidadReferenciada.name.charAt(0).toLowerCase()}${entidadReferenciada.name.slice(1)}`;
        let nombre = base;
        if (grupo.length > 1) {
          const rol = entidadReferenciada.id === conn.source ? conn.sourceName : conn.targetName;
          nombre = this.identificadorJava(rol || conn.description) || `${base}${indice + 1}`;
        }

        // Sin repetir el campo, el campo del DTO (xId) ni la columna de otro atributo
        const campos = new Set(entidadConFK.attributes.map(a => campo(a.name)));
        const columnas = new Set(entidadConFK.attributes.map(columnaDe));
        let nombreFK = nombre;
        for (let n = 2;
          campos.has(campo(nombreFK)) || campos.has(`${campo(nombreFK)}Id`) ||
          columnas.has(columnaDe({ name: nombreFK, isForeignKey: true }));
          n++) {
          nombreFK = `${nombre}${n}`;
        }

        entidadConFK.attributes.push({
          name: nombreFK,
          type: 'Long',
          sqlType: 'BIGINT',
          visibility: 'private',
          isPrimaryKey: false,
          isForeignKey: true,
          referencedEntity: entidadReferenciada.name,
          referencedField: 'id',
          referencedType: 'Long',
          // En una composición la parte no existe sin su todo: FK obligatoria
          isRequired: conn.type === 'composition'
        });
      });
    });
  };

  // Rol o etiqueta de una relacion -> identificador Java en camelCase
  // ("compuesta por" -> "compuestaPor", "Dirección" -> "direccion")
  identificadorJava = (texto) => {
    const palabras = String(texto || '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean);
    if (!palabras.length) return '';
    const unido = palabras
      .map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1)))
      .join('');
    return this.normalizeJavaFieldName(unido);
  };

  exportarSpringBootDesdeSala = async (req, res) => {
    const { id } = req.params;
    try {
      // Solo el dueño o los invitados del tablero pueden exportarlo
      const acceso = await puedeAccederASala(req.user && req.user.id, id);
      if (!acceso.ok) return response(res, acceso.status, { error: acceso.message });

      const [sala] = await getSalaById(id);
      if (!sala) return response(res, 404, { error: 'El tablero no existe o fue eliminado.' });
      if (!sala.xml || sala.xml.trim() === '') return response(res, 400, { error: 'El tablero está vacío: agrega al menos una clase antes de exportar.' });

      let salaData;
      try { salaData = JSON.parse(sala.xml); } catch (err) { return response(res, 400, { error: 'El contenido del tablero está dañado y no se puede exportar. Abre el tablero, guárdalo e intenta de nuevo.' }); }

      // Support different shapes saved in sala.xml: older code may store { elements, connections }
      // while the frontend currently stores { nodes, edges }. Accept both.
      let elements = [];
      let connections = [];
      if (salaData.elements) {
        elements = Array.isArray(salaData.elements) ? salaData.elements : Object.values(salaData.elements);
      } else if (salaData.nodes) {
        elements = Array.isArray(salaData.nodes) ? salaData.nodes : Object.values(salaData.nodes);
      }

      if (salaData.connections) {
        connections = Array.isArray(salaData.connections) ? salaData.connections : Object.values(salaData.connections);
      } else if (salaData.edges) {
        connections = Array.isArray(salaData.edges) ? salaData.edges : Object.values(salaData.edges);
      }

      if (elements.length === 0) return response(res, 400, { error: 'El tablero no tiene clases: agrega al menos una clase para generar el proyecto Spring Boot.' });

      const projectName = `spring-boot-${sanitizarNombreProyecto(sala.title)}-${Date.now()}`;
      const dbName = nombreBaseDatos(sala.title);

      const converted = this.convertirFrontendADiagramParser(elements, connections, salaData.permisos ?? null);
      // De qué trata el sistema: el asistente del proyecto generado lo usa como contexto
      const proposito = await describirProyecto({
        titulo: sala.title,
        descripcion: sala.description,
        entidades: Object.values(converted.elements || {}),
        relaciones: Object.values(converted.connections || {})
      });
      const builder = new SpringBootProjectBuilder(projectName, JSON.stringify(converted), rutaBase, {
        dbName,
        nombreProyecto: sanitizarNombreProyecto(sala.title),
        proposito
      });
      console.log('🚀 Iniciando generación de proyecto Spring Boot desde sala con SpringBootProjectBuilder...');
      await builder.build();

      // La base viaja con el backend: el mismo script del botón "SQL", en database/
      const carpetaBD = path.join(resolverDentroDeBase(projectName), 'database');
      fs.mkdirSync(carpetaBD, { recursive: true });
      fs.writeFileSync(path.join(carpetaBD, `${dbName}.sql`), new SqlDDLGenerator(converted, dbName).generate());
      console.log('✅ Proyecto Spring Boot generado exitosamente desde sala');
      await this.comprimirProyecto(projectName);
      await this.enviarZip(res, projectName, `${sanitizarNombreProyecto(sala.title)}-spring-boot.zip`);
    } catch (error) {
      console.error('❌ Error exportando Spring Boot desde sala:', error?.message || error);
      if (error?.code === 'PERMISOS_INVALIDOS') return response(res, 400, { error: error.message });
      return response(res, 500, { error: 'No se pudo generar el proyecto Spring Boot. Revisa que las clases tengan nombre y atributos válidos e intenta de nuevo.' });
    }
  };

  // Exporta el MODELO RELACIONAL como script DDL de PostgreSQL.
  // Usa la misma conversion que el exportador de Spring Boot, asi que el esquema
  // resultante coincide con el que Hibernate crea al arrancar el proyecto.
  exportarSQLDesdeSala = async (req, res) => {
    const { id } = req.params;
    try {
      const acceso = await puedeAccederASala(req.user && req.user.id, id);
      if (!acceso.ok) return response(res, acceso.status, { error: acceso.message });

      const [sala] = await getSalaById(id);
      if (!sala) return response(res, 404, { error: 'El tablero no existe o fue eliminado.' });
      if (!sala.xml || sala.xml.trim() === '') return response(res, 400, { error: 'El tablero está vacío: agrega al menos una clase antes de exportar.' });

      let salaData;
      try { salaData = JSON.parse(sala.xml); } catch (err) { return response(res, 400, { error: 'El contenido del tablero está dañado y no se puede exportar. Abre el tablero, guárdalo e intenta de nuevo.' }); }

      let elements = [];
      let connections = [];
      if (salaData.elements) elements = Array.isArray(salaData.elements) ? salaData.elements : Object.values(salaData.elements);
      else if (salaData.nodes) elements = Array.isArray(salaData.nodes) ? salaData.nodes : Object.values(salaData.nodes);
      if (salaData.connections) connections = Array.isArray(salaData.connections) ? salaData.connections : Object.values(salaData.connections);
      else if (salaData.edges) connections = Array.isArray(salaData.edges) ? salaData.edges : Object.values(salaData.edges);

      if (elements.length === 0) return response(res, 400, { error: 'El diagrama no tiene clases: agrega al menos una para generar el script SQL.' });

      const converted = this.convertirFrontendADiagramParser(elements, connections, salaData.permisos ?? null);
      const dbName = nombreBaseDatos(sala.title);
      const ddl = new SqlDDLGenerator(converted, dbName).generate();

      const nombreArchivo = `${sanitizarNombreProyecto(sala.title)}-modelo-relacional.sql`;
      res.setHeader('Content-Type', 'application/sql; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
      return res.send(ddl);
    } catch (error) {
      console.error('❌ Error exportando SQL:', error?.message || error);
      if (error?.code === 'PERMISOS_INVALIDOS') return response(res, 400, { error: error.message });
      return response(res, 500, { error: 'No se pudo generar el script SQL. Revisa que las clases tengan nombre y atributos válidos e intenta de nuevo.' });
    }
  };

  exportarSpringBootConRelaciones = async (req, res) => {
    // Payload-based export has been disabled. Export must be requested by sala id
    // to ensure we always use the saved/authorized diagram on the server.
    console.warn('Deprecated attempt to use payload-based Spring Boot export. This endpoint is disabled.');
    return response(res, 405, { error: 'Esta forma de exportar ya no está disponible. Exporta desde el tablero abierto.' });
  };

  parseStringAttribute = (attrString) => {
    const clean = (attrString || '').trim();
    if (!clean) return { name: 'defaultField', type: 'String', visibility: 'private', isPrimaryKey: false, isForeignKey: false, isStatic: false };
    const patterns = [/^([+\-#~])?\s*(\w+)\s*:\s*(\w+)$/, /^([+\-#~])?\s*(\w+)\s+(\w+)$/, /^(\w+)\s*:\s*(\w+)$/, /^(\w+)\s+(\w+)$/, /^(\w+)$/];
    let match = null; let idx = -1;
    for (let i=0;i<patterns.length;i++){ match = clean.match(patterns[i]); if(match){ idx=i; break; }}
    let visibility='private', name='field', type='String';
    if (match) {
      switch(idx){
        case 0: visibility = this.getVisibilityFromSymbol(match[1]||'+'); name = this.normalizeJavaFieldName(match[2]); type = this.mapJavaType(match[3]); break;
        case 1: visibility = this.getVisibilityFromSymbol(match[1]||'+'); type = this.mapJavaType(match[2]); name = this.normalizeJavaFieldName(match[3]); break;
        case 2: name = this.normalizeJavaFieldName(match[1]); type = this.mapJavaType(match[2]); break;
        case 3: type = this.mapJavaType(match[1]); name = this.normalizeJavaFieldName(match[2]); break;
        case 4: name = this.normalizeJavaFieldName(match[1]); break;
      }
    }
    const esClave = name.toLowerCase() === 'id';
    // "id" escrito sin tipo: clave numérica generada por la base
    if (esClave && idx === 4) type = 'Long';
    return { name, type, visibility, isPrimaryKey: esClave, isForeignKey:false, isStatic:false };
  };

  normalizeJavaFieldName = (name) => {
    if (!name || typeof name !== 'string') return 'defaultField';
    let normalized = name.trim().replace(/[^a-zA-Z0-9]/g, '');
    if (!normalized) return 'defaultField';
    if (!/^[a-zA-Z]/.test(normalized)) normalized = 'field' + normalized;
    const javaKeywords = ['abstract','boolean','break','byte','case','catch','char','class','const','continue','default','do','double','else','enum','extends','final','finally','float','for','goto','if','implements','import','instanceof','int','interface','long','native','new','package','private','protected','public','return','short','static','strictfp','super','switch','synchronized','this','throw','throws','transient','try','void','volatile','while'];
    if (javaKeywords.includes(normalized.toLowerCase())) normalized += 'Field';
    return normalized;
  };

  getVisibilityFromSymbol = (symbol) => ({ '+':'public','-':'private','#':'protected','~':'package' }[symbol] || 'private');

  // La UI usa 'Association'/'Generalization'/... y DiagramParser espera
  // 'association'/'inheritance'/... en minusculas.
  mapTipoRelacion = (tipo) => {
    const t = String(tipo || 'association').toLowerCase();
    const map = {
      'association': 'association',
      'aggregation': 'aggregation',
      'composition': 'composition',
      'dependency': 'dependency',
      'generalization': 'inheritance',
      'implementation': 'inheritance',
      'realization': 'inheritance',
      'inheritance': 'inheritance',
      'many-to-many-direct': 'many-to-many-direct'
    };
    return map[t] || 'association';
  };

  // Tipos del diagrama -> tipos Java. Acepta los de UML/Java y los de SQL que traen
  // los modelos de Enterprise Architect (text, timestamp, time, point...). Antes todo
  // lo desconocido era String (un "time" no se podía guardar en una columna TIME) y
  // "date" se generaba como fecha y hora.
  mapJavaType = (type) => {
    const t = String(type || '').trim().toLowerCase().replace(/\s*\(.*\)$/, '');
    const map = {
      string: 'String', varchar: 'String', 'character varying': 'String', char: 'String', character: 'String', text: 'String',
      int: 'Integer', integer: 'Integer', smallint: 'Integer', short: 'Integer',
      long: 'Long', bigint: 'Long', serial: 'Long', bigserial: 'Long',
      double: 'Double', 'double precision': 'Double', float: 'Float', real: 'Float',
      decimal: 'BigDecimal', numeric: 'BigDecimal', bigdecimal: 'BigDecimal', money: 'BigDecimal',
      boolean: 'Boolean', bool: 'Boolean',
      date: 'LocalDate', localdate: 'LocalDate',
      datetime: 'LocalDateTime', timestamp: 'LocalDateTime', localdatetime: 'LocalDateTime',
      time: 'LocalTime', localtime: 'LocalTime',
      uuid: 'UUID'
    };
    // Geometrías (point, LineString...) y tipos desconocidos: texto
    return map[t] || 'String';
  };

  // Columna de los textos que no son VARCHAR(255): text y geometrías (WKT) sin
  // límite, char de un carácter y varchar(n) con su largo.
  sqlTypeDe = (type) => {
    const t = String(type || '').trim().toLowerCase();
    const conLargo = t.match(/^(?:varchar|character varying|char|character)\s*\((\d+)\)$/);
    if (conLargo) return `VARCHAR(${conLargo[1]})`;
    if (t === 'char' || t === 'character') return 'VARCHAR(1)';
    const sinLimite = ['text', 'point', 'linestring', 'polygon', 'multipoint', 'multilinestring', 'multipolygon', 'geometry', 'geography'];
    return sinLimite.includes(t) ? 'TEXT' : null;
  };

  capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

  // Legacy-compatible generic export endpoint: if :id provided, export from sala; otherwise use payload
  exportar = async (req, res) => {
    const { id } = req.params || {};
    try {
      if (id) return await this.exportarSpringBootDesdeSala(req, res);
      // Do not accept payload-based exports anymore — require id
      console.warn('Generic export endpoint called without id — payload export disabled');
      return response(res, 405, { error: 'Esta forma de exportar ya no está disponible. Exporta desde el tablero abierto.' });
    } catch (err) {
      console.error('❌ Error in generic export endpoint:', err);
      return response(res, 500, { error: 'No se pudo exportar el tablero. Intenta de nuevo en unos segundos.' });
    }
  };
}

export default new CrearPaginaController();
