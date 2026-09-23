#!/usr/bin/env node
/**
 * preparar-plan.mjs — Especificación de diagramas (JSON) → plan de filas para un .EAP de
 * Enterprise Architect 13.5.
 *
 * Calcula la disposición de cada diagrama en el lienzo, genera los GUID y DUID con el formato de
 * EA y ordena las inserciones (paquetes → diagramas → elementos → ubicación en el lienzo →
 * relaciones → líneas). El plan lo ejecuta escribir-eap.ps1 (PowerShell 32 bits + ODBC de Access).
 *
 * Uso:  node preparar-plan.mjs <especificacion.json> [otra.json …] <plan.json>
 * Con varias especificaciones (p. ej. una común y una por caso de uso) se juntan sus elementos y
 * diagramas en un solo plan; modelo, autor y reutilizarExistentes se toman de la primera que los tenga.
 * Sin dependencias (Node 18+). Los valores de cada fila calcan los que EA 13.5 escribe al dibujar
 * a mano (ver references/formato-eap.md).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// ───────────────────────────── utilidades ─────────────────────────────

/** GUID como los de EA 13.5: {XXXXXXXX-XXXX-4xxx-XXXX-XXXXXXXXXXXX}, tercer grupo en minúsculas. */
const guid = () => {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex').toUpperCase();
  return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16).toLowerCase()}-${h.slice(16, 20)}-${h.slice(20)}}`;
};
/** Identificador de un elemento dentro de un diagrama (ObjectStyle "DUID=…"; las líneas lo usan en SOID/EOID). */
const duid = () => randomBytes(4).toString('hex').toUpperCase();
/** "#RRGGBB" → COLORREF de Windows (R + G·256 + B·65536), que es lo que EA guarda en BCol. */
const colorEA = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return ((n >> 16) & 255) + ((n >> 8) & 255) * 256 + (n & 255) * 65536;
};
const limitar = (v, min, max) => Math.max(min, Math.min(max, Math.round(v)));
const texto255 = (t) => String(t ?? '').slice(0, 255);
const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
const claveTipo = (t) => normalizar(t).replace(/[\s-]+/g, '_');
const ahora = { fecha: 'ahora' };
const ref = (clave) => ({ ref: clave });
const refTexto = (clave) => ({ refTexto: clave });

const errores = [];
const avisos = [];

// ───────────────────────────── catálogos ─────────────────────────────

/**
 * Tipos de elemento. ot = t_object.Object_Type, gen = GenType, w/h = tamaño por defecto en el
 * lienzo, contenedor = puede tener elementos "dentro", padreReal = los de dentro se registran como
 * hijos (ParentID), igual que EA hace con los componentes desplegados en un nodo.
 */
const ELEMENTOS = {
  actor: { ot: 'Actor', gen: '<none>', w: 45, h: 90 },
  caso_uso: { ot: 'UseCase', gen: '<none>', w: 140, h: 70 },
  limite: { ot: 'Boundary', gen: '<none>', w: 320, h: 220, borde: 3, extra: { PDATA1: '0', PDATA2: '0', PDATA3: '0' }, contenedor: true },
  clase: { ot: 'Class', gen: 'Java', w: 150, h: 70, extra: { PDATA4: '0' }, miembros: true },
  interfaz: { ot: 'Interface', gen: 'Java', w: 150, h: 60, estereotipo: 'interface', abstracta: true, miembros: true },
  enumeracion: { ot: 'Enumeration', gen: 'Java', w: 140, h: 70, miembros: true },
  componente: { ot: 'Component', gen: 'Java', w: 130, h: 60 },
  base_datos: { ot: 'Component', gen: 'Java', w: 130, h: 60, estereotipo: 'Database', color: '#C0C0C0' },
  paquete: { ot: 'Package', gen: 'Java', w: 150, h: 90, contenedor: true, esPaquete: true },
  nodo: { ot: 'Node', gen: 'Java', w: 180, h: 120, contenedor: true, padreReal: true },
  dispositivo: { ot: 'Node', gen: 'Java', w: 180, h: 120, estereotipo: 'device', contenedor: true, padreReal: true },
  servidor: { ot: 'Node', gen: 'Java', w: 180, h: 120, estereotipo: 'server', contenedor: true, padreReal: true },
  servidor_bd: { ot: 'Node', gen: 'Java', w: 180, h: 120, estereotipo: 'database server', contenedor: true, padreReal: true },
  entorno: { ot: 'ExecutionEnvironment', gen: 'Java', w: 170, h: 100, contenedor: true, padreReal: true },
  artefacto: { ot: 'Artifact', gen: 'Java', w: 120, h: 50 },
  linea_vida: { ot: 'Sequence', gen: '<none>', w: 90, h: 60 },
  estado: { ot: 'State', gen: 'Java', w: 110, h: 40, extra: { PDATA1: '0', PDATA2: '0' } },
  inicial: { ot: 'StateNode', gen: '<none>', w: 20, h: 20, ntype: 3, etiqueta: true },
  final: { ot: 'StateNode', gen: '<none>', w: 20, h: 20, ntype: 4, etiqueta: true },
  decision: { ot: 'StateNode', gen: '<none>', w: 40, h: 40, ntype: 11, etiqueta: true },
  evento: { ot: 'Event', gen: '<none>', w: 130, h: 35 },
  nota: { ot: 'Note', gen: '<none>', w: 200, h: 80 },
  objeto: { ot: 'Object', gen: '<none>', w: 120, h: 50 },
};
const SINONIMOS_ELEMENTO = {
  caso_de_uso: 'caso_uso', casouso: 'caso_uso', usecase: 'caso_uso', use_case: 'caso_uso', cu: 'caso_uso',
  boundary: 'limite', sistema: 'limite', frontera: 'limite', capa: 'limite',
  class: 'clase', interface: 'interfaz', enum: 'enumeracion', enumeration: 'enumeracion',
  component: 'componente', database: 'base_datos', base_de_datos: 'base_datos', bd: 'base_datos',
  package: 'paquete', node: 'nodo', device: 'dispositivo', server: 'servidor',
  servidor_de_base_de_datos: 'servidor_bd', database_server: 'servidor_bd',
  entorno_de_ejecucion: 'entorno', executionenvironment: 'entorno', execution_environment: 'entorno',
  artifact: 'artefacto', lifeline: 'linea_vida', lineadevida: 'linea_vida', linea_de_vida: 'linea_vida', participante: 'linea_vida',
  state: 'estado', initial: 'inicial', inicio: 'inicial', fin: 'final', choice: 'decision', eleccion: 'decision',
  event: 'evento', note: 'nota', object: 'objeto',
};
const tipoElemento = (t) => {
  const k = claveTipo(t);
  return ELEMENTOS[k] ? k : SINONIMOS_ELEMENTO[k] || null;
};

/** Tipos de diagrama → t_diagram.Diagram_Type y paquete por defecto. */
const DIAGRAMAS = {
  clases: { tipo: 'Logical', paquete: 'Modelo de clases' },
  casos_uso: { tipo: 'Use Case', paquete: 'Casos de uso' },
  secuencia: { tipo: 'Sequence', paquete: 'Secuencias' },
  componentes: { tipo: 'Component', paquete: 'Componentes' },
  despliegue: { tipo: 'Deployment', paquete: 'Despliegue' },
  paquetes: { tipo: 'Package', paquete: 'Paquetes' },
  estados: { tipo: 'Statechart', paquete: 'Estados' },
  contexto: { tipo: 'Use Case', paquete: 'Contexto' },
  indice: { tipo: 'Package', paquete: '' },
};
const SINONIMOS_DIAGRAMA = {
  clase: 'clases', class: 'clases', caso_uso: 'casos_uso', casos_de_uso: 'casos_uso', use_case: 'casos_uso',
  general_casos_uso: 'casos_uso', diagrama_general: 'casos_uso', sequence: 'secuencia', secuencias: 'secuencia',
  componente: 'componentes', component: 'componentes', deployment: 'despliegue', paquete: 'paquetes',
  package: 'paquetes', estado: 'estados', statechart: 'estados', maquina_de_estados: 'estados', context: 'contexto',
};
const tipoDiagrama = (t) => {
  const k = claveTipo(t);
  return DIAGRAMAS[k] ? k : SINONIMOS_DIAGRAMA[k] || null;
};

const SINONIMOS_RELACION = {
  asociacion: 'asociacion', association: 'asociacion', comunicacion: 'asociacion', conexion: 'asociacion',
  agregacion: 'agregacion', aggregation: 'agregacion', composicion: 'composicion', composition: 'composicion',
  generalizacion: 'generalizacion', generalization: 'generalizacion', herencia: 'generalizacion', hereda: 'generalizacion',
  realizacion: 'realizacion', realization: 'realizacion', realisation: 'realizacion', implementa: 'realizacion', implementacion: 'realizacion',
  dependencia: 'dependencia', dependency: 'dependencia', usa: 'dependencia',
  include: 'include', incluye: 'include', extend: 'extend', extiende: 'extend',
  anidamiento: 'anidamiento', nesting: 'anidamiento', contiene: 'anidamiento',
  transicion: 'transicion', transition: 'transicion', flujo: 'transicion', stateflow: 'transicion',
  nota: 'nota', notelink: 'nota', enlace_nota: 'nota',
};

/** InteractionFragment.NType según el operador (0 alt, 1 opt y 4 loop verificados en EA 13.5). */
const FRAGMENTOS = { alt: 0, opt: 1, break: 2, par: 3, loop: 4, critical: 5, neg: 6, assert: 7, strict: 8, seq: 9, ignore: 10, consider: 11 };

// ───────────────────────────── plantillas de filas ─────────────────────────────

const PDATA_DIAGRAMA = 'HideRel=0;ShowTags=0;ShowReqs=0;ShowCons=0;OpParams=1;ShowSN=0;ScalePI=0;PPgs.cx=1;PPgs.cy=1;PSize=9;ShowIcons=1;SuppCN=0;HideProps=0;HideParents=0;UseAlias=0;HideAtts=0;HideOps=0;HideStereo=0;HideEStereo=0;ShowShape=1;FormName=;';
const SWIMLANES = 'locked=false;orientation=0;width=0;inbar=false;names=false;color=-1;bold=false;fcol=0;tcol=-1;ofCol=-1;ufCol=-1;hl=0;ufh=0;cls=0;SwimlaneFont=lfh:-13,lfw:0,lfi:0,lfu:0,lfs:0,lfface:Calibri,lfe:0,lfo:0,lfchar:1,lfop:0,lfcp:0,lfq:0,lfpf=0,lfWidth=0;';
const estiloDiagrama = (tipoEA) => {
  const secuencia = tipoEA === 'Sequence';
  return 'ExcludeRTF=0;DocAll=0;HideQuals=0;AttPkg=1;ShowTests=0;ShowMaint=0;' +
    `SuppressFOC=${secuencia ? 0 : 1};` +
    (secuencia ? 'INT_ARGS=;INT_RET=;INT_ATT=;SeqTopMargin=50;' : '') +
    'MatrixActive=0;SwimlanesActive=1;KanbanActive=0;MatrixLineWidth=1;MatrixLineClr=0;MatrixLocked=0;' +
    'TConnectorNotation=UML 2.1;TExplicitNavigability=0;AdvancedElementProps=1;AdvancedFeatureProps=1;' +
    'AdvancedConnectorProps=1;m_bElementClassifier=1;ProfileData=;MDGDgm=;STBLDgm=;ShowNotes=0;' +
    'VisibleAttributeDetail=0;ShowOpRetType=1;SuppressBrackets=0;SuppConnectorLabels=0;PrintPageHeadFoot=0;' +
    'ShowAsList=0;SuppressedCompartments=;' + (tipoEA === 'Statechart' ? 'SF=1;' : '') + 'Theme=:119;';
};
const ETIQUETA_NODO = 'LBL=CX=21:CY=13:OX=0:OY=0:HDN=0:BLD=0:ITA=0:UND=0:CLR=-1:ALN=1:ALT=0:ROT=0;';
/** SX/SY y EX/EY desplazan los extremos de la línea: se usan para separar relaciones entre el mismo par. */
const GEOMETRIA_LINEA = (borde, desplazamiento = 0) => {
  const horizontal = borde === 2 || borde === 4;
  const dx = horizontal ? 0 : desplazamiento, dy = horizontal ? desplazamiento : 0;
  return `SX=${dx};SY=${dy};EX=${dx};EY=${dy};EDGE=${borde};$LLB=;LLT=;LMT=;LMB=;LRT=;LRB=;IRHS=;ILHS=;`;
};
const ESTILO_LINEA = (soid, eoid) => `Mode=3;EOID=${eoid};SOID=${soid};Color=-1;LWidth=0;`;

const COMUN_OBJETO = (autor) => ({
  Diagram_ID: 0, Author: autor, Version: '1.0', NType: 0, Complexity: '1', Effort: 0,
  Backcolor: -1, BorderStyle: 0, BorderWidth: -1, Fontcolor: -1, Bordercolor: -1,
  CreatedDate: ahora, ModifiedDate: ahora, Status: 'Proposed', Abstract: '0', Tagged: 0,
  Phase: '1.0', Scope: 'Public', Classifier: 0, ParentID: 0,
  IsRoot: false, IsLeaf: false, IsSpec: false, IsActive: false,
});

const COMUN_CONECTOR = {
  SourceAccess: 'Public', DestAccess: 'Public', SourceContainment: 'Unspecified', SourceIsAggregate: 0,
  SourceIsOrdered: 0, DestContainment: 'Unspecified', DestIsAggregate: 0, DestIsOrdered: 0,
  Start_Edge: 0, End_Edge: 0, PtStartX: 0, PtStartY: 0, PtEndX: 0, PtEndY: 0, SeqNo: 0,
  HeadStyle: 0, LineStyle: 0, RouteStyle: 3, IsBold: 0, LineColor: -1, DiagramID: 0,
  SourceIsNavigable: false, DestIsNavigable: true, IsRoot: false, IsLeaf: false, IsSpec: false,
  SourceChangeable: 'none', DestChangeable: 'none', SourceTS: 'instance', DestTS: 'instance',
  IsSignal: false, IsStimulus: false,
};
const navegabilidad = (origen, destino) => ({
  SourceStyle: `Union=0;Derived=0;AllowDuplicates=0;Owned=0;Navigable=${origen};`,
  DestStyle: `Union=0;Derived=0;AllowDuplicates=0;Owned=0;Navigable=${destino};`,
});
const ESTILO_SIMPLE = { SourceStyle: 'Union=0;Derived=0;AllowDuplicates=0;', DestStyle: 'Union=0;Derived=0;AllowDuplicates=0;' };

/** Fila de t_connector para una relación (no mensajes de secuencia). */
function valoresRelacion(rel, tipoOrigen, tipoDestino) {
  if (rel.tipo === 'nota') {
    // Enlace de nota: EA guarda muy pocas columnas
    return {
      Connector_Type: 'NoteLink', SourceIsAggregate: 0, SourceIsOrdered: 0, DestIsAggregate: 0, DestIsOrdered: 0,
      Start_Edge: 0, End_Edge: 0, PtStartX: 0, PtStartY: 0, PtEndX: 0, PtEndY: 0, SeqNo: 0, HeadStyle: 0,
      LineStyle: 0, RouteStyle: 0, IsBold: 0, LineColor: 0, VirtualInheritance: '0', DiagramID: 0,
      ea_guid: rel.guid, SourceIsNavigable: false, DestIsNavigable: false, IsRoot: false, IsLeaf: false,
      IsSpec: false, IsSignal: false, IsStimulus: false,
    };
  }
  const v = { ...COMUN_CONECTOR, PDATA5: 'SX=0;SY=0;EX=0;EY=0;', ea_guid: rel.guid };
  if (rel.nombre && rel.tipo !== 'transicion') v.Name = texto255(rel.nombre);
  if (rel.estereotipo) v.Stereotype = texto255(rel.estereotipo);
  const sinEstereotipo = !rel.estereotipo;
  switch (rel.tipo) {
    case 'asociacion': {
      const casoDeUso = [tipoOrigen, tipoDestino].some((t) => t === 'Actor' || t === 'UseCase');
      Object.assign(v, {
        Connector_Type: 'Association',
        Direction: rel.dirigida ? 'Source -> Destination' : 'Unspecified',
        DestIsNavigable: rel.dirigida ? true : !casoDeUso,
        VirtualInheritance: '0',
      }, rel.dirigida ? navegabilidad('Non-Navigable', 'Navigable') : navegabilidad('Unspecified', 'Unspecified'));
      break;
    }
    case 'agregacion':
    case 'composicion':
      // La parte es el origen y el todo (rombo) el destino
      Object.assign(v, {
        Connector_Type: 'Aggregation', SubType: rel.tipo === 'composicion' ? 'Strong' : 'Weak',
        Direction: 'Source -> Destination', DestIsAggregate: rel.tipo === 'composicion' ? 2 : 1,
        VirtualInheritance: '0',
      }, navegabilidad('Unspecified', 'Unspecified'));
      break;
    case 'generalizacion':
      Object.assign(v, { Connector_Type: 'Generalization', Direction: 'Source -> Destination', VirtualInheritance: '0' }, ESTILO_SIMPLE);
      break;
    case 'realizacion':
      Object.assign(v, { Connector_Type: 'Realisation', Direction: 'Source -> Destination' }, navegabilidad('Non-Navigable', 'Navigable'));
      if (sinEstereotipo) v.VirtualInheritance = '0';
      break;
    case 'dependencia':
      Object.assign(v, { Connector_Type: 'Dependency', Direction: 'Source -> Destination' }, navegabilidad('Non-Navigable', 'Navigable'));
      if (sinEstereotipo) v.VirtualInheritance = '0';
      break;
    case 'include':
    case 'extend':
      // Conector de caso de uso con estereotipo; EA no guarda estilos de extremo en este tipo
      Object.assign(v, { Connector_Type: 'UseCase', Direction: 'Source -> Destination', Stereotype: rel.tipo, DestIsNavigable: false, VirtualInheritance: '0' });
      for (const k of ['PDATA5', 'SourceChangeable', 'DestChangeable', 'SourceTS', 'DestTS']) delete v[k];
      break;
    case 'anidamiento':
      Object.assign(v, { Connector_Type: 'Nesting', Direction: 'Source -> Destination', VirtualInheritance: '0' }, navegabilidad('Navigable', 'Unspecified'));
      delete v.PDATA5;
      break;
    case 'transicion':
      // EA muestra el texto de la transición (evento / guarda / acción) desde PDATA2
      Object.assign(v, { Connector_Type: 'StateFlow', Direction: 'Source -> Destination', VirtualInheritance: '0' }, ESTILO_SIMPLE);
      if (rel.etiqueta || rel.nombre) v.PDATA2 = texto255(rel.etiqueta || rel.nombre);
      break;
    default:
      throw new Error(`relación sin receta: ${rel.tipo}`);
  }
  if (rel.multOrigen) v.SourceCard = texto255(rel.multOrigen);
  if (rel.multDestino) v.DestCard = texto255(rel.multDestino);
  if (rel.rolOrigen) v.SourceRole = texto255(rel.rolOrigen);
  if (rel.rolDestino) v.DestRole = texto255(rel.rolDestino);
  return v;
}

const VISIBILIDAD = { '+': 'Public', '-': 'Private', '#': 'Protected', '~': 'Package' };
const NOMBRE_VISIBILIDAD = { public: 'Public', publico: 'Public', private: 'Private', privado: 'Private', protected: 'Protected', protegido: 'Protected', package: 'Package', paquete: 'Package' };
const visibilidad = (v, porDefecto) => VISIBILIDAD[v] || NOMBRE_VISIBILIDAD[normalizar(v)] || porDefecto;

/** "- nombre: String = 'x'" o {nombre, tipo, visibilidad, valor} → atributo. */
function leerAtributo(a) {
  if (typeof a === 'object' && a) {
    return { nombre: String(a.nombre ?? a.name ?? ''), tipo: String(a.tipo ?? a.type ?? ''), scope: visibilidad(a.visibilidad, 'Private'), valor: a.valor ?? a.default ?? null, estatico: !!a.estatico };
  }
  const m = /^\s*([+\-#~])?\s*([^:=]+?)\s*(?::\s*([^=]+?))?\s*(?:=\s*(.+))?\s*$/.exec(String(a));
  if (!m) return null;
  return { nombre: m[2].trim(), tipo: (m[3] || '').trim(), scope: visibilidad(m[1], 'Private'), valor: m[4] ? m[4].trim() : null, estatico: false };
}

/** "+ guardar(dto: TramiteDTO, id: Long): Tramite" o {nombre, parametros, retorno, visibilidad} → operación. */
function leerOperacion(o) {
  if (typeof o === 'object' && o) {
    const parametros = (o.parametros ?? o.params ?? []).map((p) => (typeof p === 'string' ? leerParametro(p) : { nombre: String(p.nombre ?? ''), tipo: String(p.tipo ?? '') }));
    return { nombre: String(o.nombre ?? ''), parametros, retorno: String(o.retorno ?? o.tipo ?? 'void'), scope: visibilidad(o.visibilidad, 'Public'), abstracta: !!o.abstracta, estatica: !!o.estatica };
  }
  const m = /^\s*([+\-#~])?\s*([^(]+?)\s*\(([^)]*)\)\s*(?::\s*(.+))?\s*$/.exec(String(o));
  if (!m) return null;
  const parametros = m[3].trim() ? m[3].split(',').map(leerParametro).filter(Boolean) : [];
  return { nombre: m[2].trim(), parametros, retorno: (m[4] || 'void').trim(), scope: visibilidad(m[1], 'Public'), abstracta: false, estatica: false };
}
function leerParametro(p) {
  const [nombre, tipo] = String(p).split(':').map((x) => x.trim());
  return nombre ? { nombre, tipo: tipo || '' } : null;
}

// ───────────────────────────── lectura de la especificación ─────────────────────────────

const argumentos = process.argv.slice(2);
const archivoPlan = argumentos.length >= 2 ? argumentos.pop() : null;
const archivosSpec = argumentos;
if (!archivosSpec.length || !archivoPlan) {
  console.error('Uso: node preparar-plan.mjs <especificacion.json> [otra.json …] <plan.json>');
  process.exit(2);
}
const archivoSpec = archivosSpec.join(', ');
const spec = { elementos: [], diagramas: [] };
for (const archivo of archivosSpec) {
  let parte;
  try {
    parte = JSON.parse(readFileSync(archivo, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    console.error(`No se pudo leer ${archivo}: ${e.message}`);
    process.exit(2);
  }
  for (const k of ['modelo', 'autor', 'reutilizarExistentes']) {
    if (parte[k] == null) continue;
    if (spec[k] == null) spec[k] = parte[k];
    else if (spec[k] !== parte[k]) errores.push(`${archivo}: "${k}" = ${JSON.stringify(parte[k])} no coincide con ${JSON.stringify(spec[k])} de un archivo anterior`);
  }
  spec.elementos.push(...(parte.elementos || []));
  spec.diagramas.push(...(parte.diagramas || []));
}
const nombresDiagrama = new Set();
for (const d of spec.diagramas) {
  const clave = `${normalizar(d.paquete)}|${normalizar(d.nombre)}`;
  if (nombresDiagrama.has(clave)) errores.push(`Diagrama repetido: "${d.nombre}" en el paquete "${d.paquete ?? ''}"`);
  nombresDiagrama.add(clave);
}

const AUTOR = texto255(spec.autor || 'Claude');
const MODELO = String(spec.modelo || 'Modelo generado').replace(/\//g, '-').trim();
const REUTILIZAR = !!spec.reutilizarExistentes;

/** Catálogo global: id → definición del elemento (un elemento = una fila de t_object). */
const elementos = new Map();
/** Orden de aparición para insertar contenedores antes que sus hijos. */
const ordenElementos = [];

const idPorDefecto = (tipo, nombre) => `${tipo}:${normalizar(nombre)}`;

function registrarElemento(def, paqueteDiagrama, contexto) {
  if (typeof def === 'string') return def; // referencia por id o nombre, se resuelve después
  const tipo = def.tipo ? tipoElemento(def.tipo) : null;
  const idDado = def.id != null ? String(def.id) : null;
  if (!tipo) {
    if (idDado && !def.tipo) return idDado; // solo ubicación de un elemento ya definido
    errores.push(`${contexto}: tipo de elemento desconocido "${def.tipo}" (${def.nombre ?? idDado ?? '?'})`);
    return null;
  }
  const nombre = String(def.nombre ?? def.name ?? '').trim();
  if (!nombre && !['inicial', 'final', 'decision', 'nota', 'objeto'].includes(tipo)) {
    errores.push(`${contexto}: el elemento de tipo ${tipo} no tiene nombre`);
    return null;
  }
  const id = idDado || idPorDefecto(tipo, nombre || `${tipo}-${elementos.size + 1}`);
  const previo = elementos.get(id);
  if (previo) {
    if (previo.tipo !== tipo) errores.push(`${contexto}: el id "${id}" ya es un ${previo.tipo} y aquí se define como ${tipo}`);
    // Completar datos que la primera definición no traía
    for (const k of ['estereotipo', 'nota', 'color', 'alias']) if (previo[k] == null && def[k] != null) previo[k] = def[k];
    if (!previo.atributos.length && def.atributos) previo.atributos = def.atributos.map(leerAtributo).filter(Boolean);
    if (!previo.operaciones.length && def.operaciones) previo.operaciones = def.operaciones.map(leerOperacion).filter(Boolean);
    return id;
  }
  const receta = ELEMENTOS[tipo];
  const el = {
    id, tipo, nombre, receta,
    estereotipo: def.estereotipo ?? receta.estereotipo ?? null,
    paquete: def.paquete != null ? String(def.paquete) : paqueteDiagrama,
    nota: def.nota ?? def.descripcion ?? null,
    alias: def.alias ?? null,
    color: def.color ?? receta.color ?? null,
    abstracta: def.abstracta ?? receta.abstracta ?? false,
    // "dentro" es de cada diagrama; el del catálogo global solo aplica donde también está el contenedor
    dentroGlobal: contexto === 'elementos' && def.dentro != null ? String(def.dentro) : null,
    padre: null, // contenedor real (nodo/entorno de despliegue) → ParentID
    atributos: (def.atributos || []).map(leerAtributo).filter(Boolean),
    operaciones: (def.operaciones || []).map(leerOperacion).filter(Boolean),
    reutilizar: def.reutilizar ?? REUTILIZAR,
    guid: guid(),
    clave: tipo === 'paquete' ? null : `obj:${id}`,
  };
  elementos.set(id, el);
  ordenElementos.push(id);
  return id;
}

/** Resuelve una referencia por id exacto, por id normalizado o por nombre (único). */
function resolver(refTexto, candidatos, contexto) {
  if (refTexto == null) return null;
  const r = String(refTexto);
  if (elementos.has(r)) return r;
  const n = normalizar(r);
  const porNombre = [...(candidatos || elementos.keys())].filter((id) => normalizar(elementos.get(id)?.nombre) === n || normalizar(id) === n);
  if (porNombre.length === 1) return porNombre[0];
  if (porNombre.length > 1) errores.push(`${contexto}: "${r}" es ambiguo (${porNombre.join(', ')}); usa el id`);
  else errores.push(`${contexto}: no existe el elemento "${r}"`);
  return null;
}

// Catálogo global opcional
for (const def of spec.elementos || []) registrarElemento(def, def.paquete ?? '', 'elementos');

if (!Array.isArray(spec.diagramas) || !spec.diagramas.length) errores.push('La especificación no tiene "diagramas"');

const diagramas = (spec.diagramas || []).map((d, i) => {
  const tipo = tipoDiagrama(d.tipo);
  const contexto = `diagrama ${i + 1} "${d.nombre ?? '?'}"`;
  if (!tipo) errores.push(`${contexto}: tipo de diagrama desconocido "${d.tipo}"`);
  if (!d.nombre) errores.push(`${contexto}: falta el nombre`);
  const info = DIAGRAMAS[tipo] || DIAGRAMAS.clases;
  const paquete = d.paquete != null ? String(d.paquete) : info.paquete;
  const diag = {
    indice: i, tipo, nombre: texto255(d.nombre), paquete, tipoEA: d.tipoEA || info.tipo, contexto,
    nota: d.nota ?? null, disposicion: d.disposicion || 'auto', porFila: d.porFila || null, separacionParalelas: Number(d.separacionParalelas) || 16,
    ubicaciones: new Map(), ids: [], relaciones: [], mensajes: [], fragmentos: [], dentroCrudo: new Map(), dentro: new Map(),
    centro: d.centro ?? null, sistema: d.sistema ?? null,
    mostrarRelacionesExistentes: !!d.mostrarRelacionesExistentes,
    referencias: d.diagramas ?? null, guid: guid(), clave: `diag:${i}`,
  };
  for (const def of [...(d.participantes || []), ...(d.elementos || [])]) {
    const id = registrarElemento(def, paquete, contexto);
    if (!id) continue;
    if (!diag.ids.includes(id)) diag.ids.push(id);
    if (typeof def === 'object' && def.dentro != null) diag.dentroCrudo.set(id, String(def.dentro));
    if (typeof def === 'object' && (def.x != null || def.y != null || def.ancho != null || def.alto != null)) {
      diag.ubicaciones.set(id, { x: def.x, y: def.y, w: def.ancho, h: def.alto });
    }
  }
  diag.relacionesCrudas = d.relaciones || [];
  diag.mensajesCrudos = d.mensajes || [];
  diag.fragmentosCrudos = d.fragmentos || [];
  return diag;
});

// Resolver ids de los diagramas (referencias por nombre) y relaciones
for (const diag of diagramas) {
  const crudoPorId = new Map();
  for (const [r, cont] of diag.dentroCrudo) { const id = resolver(r, null, diag.contexto); if (id) crudoPorId.set(id, cont); }
  diag.ids = diag.ids.map((r) => resolver(r, null, diag.contexto)).filter(Boolean);
  diag.ids = [...new Set(diag.ids)];
  for (const id of [...diag.ids]) {
    const el = elementos.get(id);
    const explicito = crudoPorId.get(id);
    const crudo = explicito ?? el.dentroGlobal;
    if (!crudo) continue;
    const cont = resolver(crudo, null, `${diag.contexto}, dentro de ${el.nombre}`);
    if (!cont) continue;
    if (!diag.ids.includes(cont)) {
      if (!explicito) continue; // contenedor del catálogo que no se dibuja en este diagrama
      diag.ids.push(cont); // "dentro" explícito: el contenedor se agrega al diagrama
    }
    if (!elementos.get(cont).receta.contenedor) { errores.push(`${diag.contexto}: "${el.nombre}" está dentro de "${elementos.get(cont).nombre}", que no es un contenedor (límite, paquete, nodo, dispositivo, servidor o entorno)`); continue; }
    diag.dentro.set(id, cont);
    if (elementos.get(cont).receta.padreReal) {
      if (el.padre && el.padre !== cont) avisos.push(`${diag.contexto}: "${el.nombre}" ya estaba desplegado en otro nodo; se conserva el primero como padre`);
      else el.padre = cont;
    }
  }
  const locales = new Set(diag.ids);
  for (const [n, r] of diag.relacionesCrudas.entries()) {
    const ctx = `${diag.contexto}, relación ${n + 1}`;
    const tipo = SINONIMOS_RELACION[claveTipo(r.tipo)];
    if (!tipo) { errores.push(`${ctx}: tipo de relación desconocido "${r.tipo}"`); continue; }
    const desde = resolver(r.desde ?? r.origen, [...locales], ctx);
    const hacia = resolver(r.hacia ?? r.destino, [...locales], ctx);
    if (!desde || !hacia) continue;
    diag.relaciones.push({
      tipo, desde, hacia, nombre: r.nombre ?? null, etiqueta: r.etiqueta ?? null,
      estereotipo: r.estereotipo ?? null, dirigida: !!r.dirigida,
      multOrigen: r.multOrigen ?? r.cardinalidadOrigen ?? null, multDestino: r.multDestino ?? r.cardinalidadDestino ?? null,
      rolOrigen: r.rolOrigen ?? null, rolDestino: r.rolDestino ?? null,
    });
  }
  if (diag.tipo === 'secuencia') {
    for (const [n, m] of diag.mensajesCrudos.entries()) {
      const ctx = `${diag.contexto}, mensaje ${n + 1}`;
      const desde = resolver(m.desde, [...locales], ctx);
      const hacia = resolver(m.hacia ?? m.desde, [...locales], ctx);
      if (!desde || !hacia) continue;
      diag.mensajes.push({ desde, hacia, nombre: texto255(m.nombre ?? ''), asincrono: !!m.asincrono, retorno: !!m.retorno });
    }
    for (const [n, f] of diag.fragmentosCrudos.entries()) {
      const ctx = `${diag.contexto}, fragmento ${n + 1}`;
      const operador = normalizar(f.tipo || 'alt');
      if (!(operador in FRAGMENTOS)) { errores.push(`${ctx}: operador desconocido "${f.tipo}" (usa ${Object.keys(FRAGMENTOS).join(', ')})`); continue; }
      const desde = Number(f.desde), hasta = Number(f.hasta ?? f.desde);
      if (!(desde >= 1 && hasta >= desde && hasta <= diag.mensajes.length)) {
        errores.push(`${ctx}: "desde"/"hasta" deben ser números de mensaje entre 1 y ${diag.mensajes.length}`);
        continue;
      }
      diag.fragmentos.push({ operador, condicion: texto255(f.condicion ?? ''), desde, hasta, guid: guid() });
    }
    for (const id of diag.ids) {
      const t = elementos.get(id).tipo;
      if (!['actor', 'linea_vida', 'nota'].includes(t)) avisos.push(`${diag.contexto}: "${elementos.get(id).nombre}" (${t}) no es actor ni línea de vida`);
    }
  }
}

if (errores.length) {
  console.error(`La especificación tiene ${errores.length} error(es):`);
  for (const e of errores) console.error(`  - ${e}`);
  process.exit(1);
}

// ───────────────────────────── disposición en el lienzo ─────────────────────────────

/** Tamaño de un elemento según su tipo, nombre y miembros (clases). */
function tamano(el) {
  const r = el.receta;
  const largo = el.nombre.length;
  switch (el.tipo) {
    case 'caso_uso': return { w: limitar(largo * 5.5 + 50, 130, 220), h: largo > 38 ? 80 : 70 };
    case 'componente': case 'base_datos': case 'artefacto': case 'objeto':
      return { w: limitar(largo * 7 + 40, r.w, 240), h: r.h + (el.estereotipo ? 5 : 0) };
    case 'estado': case 'evento': return { w: limitar(largo * 7 + 30, r.w, 240), h: r.h };
    // Calibrado con los diagramas del usuario: EA muestra nombres de ~20 letras en cabeceras de 90-100 px
    case 'linea_vida': return { w: limitar(largo * 5 + 15, 90, 180), h: 0 };
    case 'nota': return { w: r.w, h: limitar(40 + String(el.nota ?? '').length * 0.6, 60, 240) };
    case 'clase': case 'interfaz': case 'enumeracion': {
      const lineas = [el.nombre, ...el.atributos.map((a) => `${a.nombre}: ${a.tipo}`), ...el.operaciones.map((o) => `${o.nombre}(${o.parametros.map((p) => `${p.nombre}: ${p.tipo}`).join(', ')}): ${o.retorno}`)];
      const ancho = Math.max(...lineas.map((l) => l.length));
      const alto = 34 + (el.estereotipo ? 14 : 0) + el.atributos.length * 15 + (el.operaciones.length ? 10 + el.operaciones.length * 15 : 0) + 10;
      return { w: limitar(ancho * 6.3 + 30, 130, 420), h: Math.max(r.h, alto) };
    }
    default: return { w: r.w, h: r.h };
  }
}

const PAD = 20;
const PAD_ARRIBA = 40;

/** Mide recursivamente un elemento con sus hijos (grilla dentro del contenedor). */
function medir(id, hijosDe, porFila) {
  const el = elementos.get(id);
  const base = tamano(el);
  const hijos = hijosDe.get(id) || [];
  if (!hijos.length) return { w: base.w, h: base.h, hijos: [] };
  const medidas = hijos.map((h) => ({ id: h, ...medir(h, hijosDe, porFila) }));
  const columnas = Math.min(porFila || Math.ceil(Math.sqrt(medidas.length)), medidas.length);
  const GAP = 30;
  let y = PAD_ARRIBA, anchoMax = 0;
  const colocados = [];
  for (let i = 0; i < medidas.length; i += columnas) {
    const fila = medidas.slice(i, i + columnas);
    let x = PAD;
    for (const m of fila) { colocados.push({ ...m, rx: x, ry: y }); x += m.w + GAP; }
    anchoMax = Math.max(anchoMax, x - GAP);
    y += Math.max(...fila.map((m) => m.h)) + GAP;
  }
  return { w: Math.max(base.w, anchoMax + PAD), h: Math.max(base.h, y - GAP + PAD), hijos: colocados };
}

function ubicar(pos, id, x, y, medida) {
  pos.set(id, { x: Math.round(x), y: Math.round(y), w: Math.round(medida.w), h: Math.round(medida.h) });
  for (const h of medida.hijos) ubicar(pos, h.id, x + h.rx, y + h.ry, h);
}

/** Disposición genérica: contenedores con hijos, en grilla o apilados por capas. */
function disponerContenedores(diag, pos, porCapas) {
  const presentes = new Set(diag.ids);
  const hijosDe = new Map();
  const raiz = [];
  for (const id of diag.ids) {
    const cont = diag.dentro.get(id);
    const padre = cont && presentes.has(cont) ? cont : null;
    if (padre) { if (!hijosDe.has(padre)) hijosDe.set(padre, []); hijosDe.get(padre).push(id); }
    else raiz.push(id);
  }
  const porFila = diag.porFila || (porCapas ? 5 : null);
  const medidas = raiz.map((id) => ({ id, ...medir(id, hijosDe, porFila) }));
  if (porCapas) {
    const contenedores = medidas.filter((m) => m.hijos.length);
    const sueltos = medidas.filter((m) => !m.hijos.length);
    const ancho = Math.max(0, ...contenedores.map((m) => m.w));
    let y = 20;
    for (const m of contenedores) { m.w = ancho; ubicar(pos, m.id, 20, y, m); y += m.h + 15; }
    let x = 20;
    for (const m of sueltos) { ubicar(pos, m.id, x, y + 20, m); x += m.w + 40; }
    return;
  }
  const columnas = Math.max(1, Math.ceil(Math.sqrt(medidas.length)));
  let y = 20;
  for (let i = 0; i < medidas.length; i += columnas) {
    const fila = medidas.slice(i, i + columnas);
    let x = 20;
    for (const m of fila) { ubicar(pos, m.id, x, y, m); x += m.w + 70; }
    y += Math.max(...fila.map((m) => m.h)) + 70;
  }
}

/** Casos de uso: actores a los lados, casos de uso en grilla dentro del límite del sistema. */
function disponerCasosUso(diag, pos) {
  const els = diag.ids.map((id) => elementos.get(id));
  const actores = els.filter((e) => e.tipo === 'actor');
  const casos = els.filter((e) => e.tipo === 'caso_uso');
  let limite = els.find((e) => e.tipo === 'limite');
  const paquetes = els.filter((e) => e.tipo === 'paquete');
  const otros = els.filter((e) => !['actor', 'caso_uso', 'limite', 'paquete'].includes(e.tipo));
  const grado = (id) => diag.relaciones.filter((r) => r.desde === id || r.hacia === id).length;
  actores.sort((a, b) => grado(b.id) - grado(a.id));
  const izquierda = actores.length > 2 ? actores.filter((_, i) => i % 2 === 0) : actores;
  const derecha = actores.length > 2 ? actores.filter((_, i) => i % 2 === 1) : [];
  // Ordenar los casos de uso por el primer actor al que se conectan para cruzar menos líneas
  const indiceActor = new Map(actores.map((a, i) => [a.id, i]));
  const primerActor = (cu) => {
    const r = diag.relaciones.find((x) => (x.desde === cu.id && indiceActor.has(x.hacia)) || (x.hacia === cu.id && indiceActor.has(x.desde)));
    return r ? indiceActor.get(indiceActor.has(r.desde) ? r.desde : r.hacia) : actores.length;
  };
  casos.sort((a, b) => primerActor(a) - primerActor(b));
  const columnas = casos.length <= 4 ? 1 : casos.length <= 10 ? 2 : 3;
  const tam = casos.map((c) => tamano(c));
  const anchoCol = Math.max(140, ...tam.map((t) => t.w));
  const filas = Math.ceil(casos.length / columnas) || 1;
  const X_LIMITE = izquierda.length ? 190 : 40;
  const cx = X_LIMITE + 40;
  const anchoLimite = columnas * anchoCol + (columnas - 1) * 40 + 80;
  // Alto suficiente para los casos de uso y para los actores de cada lado (90 px cada uno)
  const altoLimite = Math.max(filas * 110 + 60, 200, (Math.max(izquierda.length, derecha.length) + 1) * 130);
  const y0 = 20 + Math.max(40, (altoLimite - (filas * 110 - 40)) / 2);
  casos.forEach((c, i) => {
    const col = i % columnas, fila = Math.floor(i / columnas);
    pos.set(c.id, { x: cx + col * (anchoCol + 40), y: Math.round(y0 + fila * 110), w: tam[i].w, h: tam[i].h });
  });
  if (!limite && diag.sistema) {
    const id = registrarElemento({ tipo: 'limite', nombre: diag.sistema, id: `limite:${diag.indice}:${normalizar(diag.sistema)}` }, diag.paquete, diag.contexto);
    diag.ids.push(id);
    limite = elementos.get(id);
  }
  if (limite) pos.set(limite.id, { x: X_LIMITE, y: 20, w: anchoLimite, h: altoLimite });
  const repartir = (lista, x) => {
    const paso = altoLimite / (lista.length + 1);
    lista.forEach((a, i) => pos.set(a.id, { x, y: Math.round(20 + paso * (i + 1) - 45), w: 45, h: 90 }));
  };
  repartir(izquierda, 40);
  repartir(derecha, X_LIMITE + anchoLimite + 110);
  let yAbajo = 20 + altoLimite + 60;
  let x = 40;
  for (const p of paquetes) { const t = tamano(p); pos.set(p.id, { x, y: yAbajo, w: t.w, h: t.h }); x += t.w + 60; }
  if (paquetes.length) yAbajo += 150;
  x = 40;
  for (const o of otros) { const t = tamano(o); pos.set(o.id, { x, y: yAbajo, w: t.w, h: t.h }); x += t.w + 40; }
}

/** Clases: grilla en orden de recorrido por relaciones (las conectadas quedan cerca). */
function disponerClases(diag, pos) {
  const vecinos = new Map(diag.ids.map((id) => [id, []]));
  for (const r of diag.relaciones) { vecinos.get(r.desde)?.push(r.hacia); vecinos.get(r.hacia)?.push(r.desde); }
  const orden = [];
  const visto = new Set();
  const porGrado = [...diag.ids].sort((a, b) => vecinos.get(b).length - vecinos.get(a).length);
  for (const inicio of porGrado) {
    if (visto.has(inicio)) continue;
    const cola = [inicio];
    visto.add(inicio);
    while (cola.length) {
      const id = cola.shift();
      orden.push(id);
      for (const v of vecinos.get(id)) if (!visto.has(v)) { visto.add(v); cola.push(v); }
    }
  }
  const columnas = diag.porFila || Math.max(1, Math.ceil(Math.sqrt(orden.length)));
  let y = 20;
  for (let i = 0; i < orden.length; i += columnas) {
    const fila = orden.slice(i, i + columnas).map((id) => ({ id, ...tamano(elementos.get(id)) }));
    let x = 20;
    for (const f of fila) { pos.set(f.id, { x, y, w: f.w, h: f.h }); x += f.w + 90; }
    y += Math.max(...fila.map((f) => f.h)) + 80;
  }
}

/** Contexto: el sistema al centro y las entidades externas en anillo. */
function disponerContexto(diag, pos) {
  const centro = diag.centro ? resolver(diag.centro, diag.ids, diag.contexto) : diag.ids.find((id) => ['limite', 'componente'].includes(elementos.get(id).tipo));
  if (!centro) { errores.push(`${diag.contexto}: indica "centro" (el sistema)`); return; }
  const otros = diag.ids.filter((id) => id !== centro);
  const tc = tamano(elementos.get(centro));
  const wc = Math.max(tc.w, 200), hc = Math.max(tc.h, 100);
  const radio = Math.max(260, otros.length * 45);
  const cx = radio + 150, cy = radio + 60;
  pos.set(centro, { x: cx - wc / 2, y: cy - hc / 2, w: wc, h: hc });
  otros.forEach((id, i) => {
    const t = tamano(elementos.get(id));
    const ang = (2 * Math.PI * i) / otros.length - Math.PI / 2;
    pos.set(id, { x: Math.round(cx + radio * 1.25 * Math.cos(ang) - t.w / 2), y: Math.round(cy + radio * Math.sin(ang) - t.h / 2), w: t.w, h: t.h });
  });
}

/** Estados: columnas por distancia desde el estado inicial. */
function disponerEstados(diag, pos) {
  const salientes = new Map(diag.ids.map((id) => [id, []]));
  for (const r of diag.relaciones) salientes.get(r.desde)?.push(r.hacia);
  const nivel = new Map();
  const inicios = diag.ids.filter((id) => elementos.get(id).tipo === 'inicial');
  const cola = (inicios.length ? inicios : diag.ids.slice(0, 1)).map((id) => { nivel.set(id, 0); return id; });
  while (cola.length) {
    const id = cola.shift();
    for (const s of salientes.get(id) || []) if (!nivel.has(s)) { nivel.set(s, nivel.get(id) + 1); cola.push(s); }
  }
  const maxNivel = Math.max(0, ...nivel.values());
  for (const id of diag.ids) {
    if (nivel.has(id)) continue;
    const t = elementos.get(id).tipo;
    nivel.set(id, t === 'final' ? maxNivel + 1 : t === 'evento' || t === 'nota' ? -1 : maxNivel + 1);
  }
  // Los finales van a la última columna
  const ultima = Math.max(...[...nivel.values()]);
  for (const id of diag.ids) if (elementos.get(id).tipo === 'final') nivel.set(id, Math.max(nivel.get(id), ultima));
  const columnas = new Map();
  for (const id of diag.ids) { const n = nivel.get(id); if (n < 0) continue; if (!columnas.has(n)) columnas.set(n, []); columnas.get(n).push(id); }
  let x = 20, altoMax = 0;
  for (const n of [...columnas.keys()].sort((a, b) => a - b)) {
    const ids = columnas.get(n);
    const tams = ids.map((id) => tamano(elementos.get(id)));
    const ancho = Math.max(...tams.map((t) => t.w));
    let y = 40;
    ids.forEach((id, i) => { pos.set(id, { x: Math.round(x + (ancho - tams[i].w) / 2), y, w: tams[i].w, h: tams[i].h }); y += tams[i].h + 60; });
    altoMax = Math.max(altoMax, y);
    x += ancho + 110;
  }
  let xe = 20;
  for (const id of diag.ids.filter((i) => nivel.get(i) < 0)) { const t = tamano(elementos.get(id)); pos.set(id, { x: xe, y: altoMax + 20, w: t.w, h: t.h }); xe += t.w + 30; }
}

/** Secuencia: líneas de vida, mensajes hacia abajo y fragmentos que abarcan sus mensajes. */
function disponerSecuencia(diag, pos) {
  const participantes = diag.ids.filter((id) => ['actor', 'linea_vida'].includes(elementos.get(id).tipo));
  const indice = new Map(participantes.map((id, i) => [id, i]));
  // Separación entre líneas de vida vecinas según el texto de los mensajes entre ellas (con tope: en los
  // diagramas del usuario las vecinas están a 120-150 px y EA deja que los rótulos largos crucen líneas)
  const necesaria = participantes.map(() => 0);
  for (const m of diag.mensajes) {
    const a = indice.get(m.desde), b = indice.get(m.hacia);
    if (a == null || b == null || a === b) continue;
    if (Math.abs(a - b) === 1) necesaria[Math.min(a, b)] = Math.max(necesaria[Math.min(a, b)], Math.min(m.nombre.length * 5 + 24, 240));
  }
  const anchos = participantes.map((id) => (elementos.get(id).tipo === 'actor' ? 50 : tamano(elementos.get(id)).w));
  const centros = [];
  participantes.forEach((id, i) => {
    if (i === 0) centros.push(20 + anchos[0] / 2);
    else centros.push(centros[i - 1] + Math.max(130, anchos[i - 1] / 2 + anchos[i] / 2 + 40, necesaria[i - 1]));
  });
  // Posición vertical de cada mensaje (espacio extra al abrir y cerrar fragmentos)
  const ys = [];
  let y = 130;
  diag.mensajes.forEach((m, i) => {
    const n = i + 1;
    // Espacio para el rótulo de la condición: sin él se encima con el rótulo del primer mensaje
    y += diag.fragmentos.filter((f) => f.desde === n).length * 42;
    ys.push(y);
    y += m.desde === m.hacia ? 45 : 30;
    y += diag.fragmentos.filter((f) => f.hasta === n).length * 18;
  });
  const fondo = y + 30;
  participantes.forEach((id, i) => pos.set(id, { x: Math.round(centros[i] - anchos[i] / 2), y: 50, w: anchos[i], h: fondo - 50 }));
  diag.posMensajes = diag.mensajes.map((m, i) => {
    const cs = centros[indice.get(m.desde)] ?? 0, cd = centros[indice.get(m.hacia)] ?? 0;
    const yy = ys[i];
    if (m.desde === m.hacia) return { sx: cs + 5, sy: yy, ex: cs + 10, ey: yy + 15, se: 2, ee: 4 };
    return cd >= cs ? { sx: cs + 5, sy: yy, ex: cd - 5, ey: yy, se: 2, ee: 4 } : { sx: cs - 5, sy: yy, ex: cd + 5, ey: yy, se: 4, ee: 2 };
  });
  diag.fragmentos.forEach((f, k) => {
    const involucrados = new Set();
    for (let n = f.desde; n <= f.hasta; n++) { involucrados.add(indice.get(diag.mensajes[n - 1].desde)); involucrados.add(indice.get(diag.mensajes[n - 1].hacia)); }
    const cs = [...involucrados].filter((v) => v != null).map((v) => centros[v]);
    const x1 = Math.min(...cs) - 45, x2 = Math.max(...cs) + 45 + (f.desde === f.hasta && diag.mensajes[f.desde - 1].desde === diag.mensajes[f.desde - 1].hacia ? 40 : 0);
    // Fragmentos que empiezan en el mismo mensaje: el que abarca más queda más arriba
    const exteriores = diag.fragmentos.filter((g, j) => g !== f && g.desde === f.desde && (g.hasta > f.hasta || (g.hasta === f.hasta && j < k))).length;
    const y1 = ys[f.desde - 1] - 38 - exteriores * 42, y2 = ys[f.hasta - 1] + (diag.mensajes[f.hasta - 1].desde === diag.mensajes[f.hasta - 1].hacia ? 30 : 15);
    f.clave = `obj:__fragmento:${diag.indice}:${k}`;
    f.pos = { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
  });
}

/** Índice: un marco de diagrama (UMLDiagram) por cada diagrama referenciado. */
function disponerIndice(diag) {
  const nombres = diag.referencias ? diag.referencias.map(normalizar) : null;
  const objetivos = diagramas.filter((d) => d !== diag && d.tipo !== 'indice' && (!nombres || nombres.includes(normalizar(d.nombre))));
  if (nombres && objetivos.length !== nombres.length) avisos.push(`${diag.contexto}: algunos diagramas de "diagramas" no existen en la especificación`);
  diag.marcos = objetivos.map((d, i) => ({
    destino: d.clave, nombre: d.nombre, guid: guid(), clave: `obj:__marco:${diag.indice}:${i}`,
    pos: { x: 20 + (i % 3) * 340, y: 20 + Math.floor(i / 3) * 200, w: 320, h: 180 },
  }));
}

for (const diag of diagramas) {
  const pos = new Map();
  switch (diag.tipo) {
    case 'casos_uso': disponerCasosUso(diag, pos); break;
    case 'clases': disponerClases(diag, pos); break;
    case 'contexto': disponerContexto(diag, pos); break;
    case 'estados': disponerEstados(diag, pos); break;
    case 'secuencia': disponerSecuencia(diag, pos); break;
    case 'indice': disponerIndice(diag); break;
    default: disponerContenedores(diag, pos, diag.disposicion === 'capas');
  }
  // Ubicaciones manuales pisan a las automáticas
  for (const [id, u] of diag.ubicaciones) {
    const real = resolver(id, diag.ids, diag.contexto);
    if (!real) continue;
    const actual = pos.get(real) || { ...tamano(elementos.get(real)), x: 20, y: 20 };
    pos.set(real, { x: u.x ?? actual.x, y: u.y ?? actual.y, w: u.w ?? actual.w, h: u.h ?? actual.h });
  }
  if (diag.disposicion === 'manual') {
    for (const id of diag.ids) if (!diag.ubicaciones.has(id)) avisos.push(`${diag.contexto}: "${elementos.get(id).nombre}" no tiene x/y (se usó la posición automática)`);
  }
  diag.pos = pos;
}

if (errores.length) {
  console.error(`La especificación tiene ${errores.length} error(es):`);
  for (const e of errores) console.error(`  - ${e}`);
  process.exit(1);
}

// ───────────────────────────── plan de inserción ─────────────────────────────

const pasos = [];
const rutaPaquete = (relativa) => [MODELO, ...String(relativa ?? '').split('/').map((p) => p.trim()).filter(Boolean)].join('/');

// Paquetes: se buscan por nombre y padre (para agregar a un proyecto existente) y se crean si faltan
pasos.push({ accion: 'buscar', tabla: 't_package', donde: { Parent_ID: 0 }, columnaId: 'Package_ID', clave: 'pkg:', obligatorio: true, descripcion: 'paquete raíz (Model)' });
const paquetesCreados = new Set();
function asegurarPaquete(ruta, porObjeto = null) {
  if (paquetesCreados.has(ruta)) return;
  const partes = ruta.split('/');
  const padre = partes.slice(0, -1).join('/');
  if (padre) asegurarPaquete(padre);
  paquetesCreados.add(ruta);
  const clave = `pkg:${ruta}`, clavePadre = `pkg:${padre}`;
  const g = porObjeto?.guid || guid();
  const nombre = texto255(partes[partes.length - 1]);
  pasos.push({ accion: 'buscar', tabla: 't_package', donde: { Name: nombre, Parent_ID: ref(clavePadre) }, columnaId: 'Package_ID', columnaGuid: 'ea_guid', clave });
  pasos.push({
    accion: 'insertar', siNoExiste: clave, tabla: 't_package', columnaId: 'Package_ID', clave,
    valores: {
      Name: nombre, Parent_ID: ref(clavePadre), CreatedDate: ahora, ModifiedDate: ahora, ea_guid: g,
      IsControlled: false, Version: '1.0', Protected: false, UseDTD: false, LogXML: false, TPos: 0,
      BatchSave: 0, BatchLoad: 0, ...(padre ? {} : { PackageFlags: 'isModel=1;VICON=0;CRC=0;' }),
    },
  });
  // Todo paquete (menos la raíz Model) tiene además su fila en t_object con el mismo ea_guid
  const valoresObjeto = {
    Object_Type: 'Package', Name: nombre, ...COMUN_OBJETO(AUTOR), GenType: 'Java',
    Package_ID: ref(clavePadre), PDATA1: refTexto(clave), ea_guid: g,
  };
  if (porObjeto?.estereotipo) valoresObjeto.Stereotype = texto255(porObjeto.estereotipo);
  if (porObjeto?.nota) valoresObjeto.Note = String(porObjeto.nota);
  pasos.push({ accion: 'insertar', soloSiNuevo: clave, tabla: 't_object', columnaId: 'Object_ID', clave: `objpkg:${ruta}`, valores: valoresObjeto });
  pasos.push({ accion: 'buscar', siNoExiste: `objpkg:${ruta}`, tabla: 't_object', donde: { Object_Type: 'Package', ea_guid: { guidDe: clave } }, columnaId: 'Object_ID', columnaGuid: 'ea_guid', clave: `objpkg:${ruta}` });
  if (porObjeto?.estereotipo) pasos.push(xrefEstereotipo(`objpkg:${ruta}`, porObjeto.estereotipo, 'element property', clave));
}
const xrefEstereotipo = (claveDueno, estereotipo, tipo, soloSiNuevo) => ({
  accion: 'insertar', soloSiNuevo: soloSiNuevo || claveDueno, tabla: 't_xref',
  valores: {
    XrefID: guid(), Name: 'Stereotypes', Type: tipo, Visibility: 'Public', Partition: '0',
    Description: `@STEREO;Name=${estereotipo};@ENDSTEREO;`, Client: { guidDe: claveDueno }, Supplier: '<none>',
  },
});

// Paquetes de diagramas y elementos
for (const diag of diagramas) asegurarPaquete(rutaPaquete(diag.paquete));
for (const id of ordenElementos) {
  const el = elementos.get(id);
  if (el.tipo === 'paquete') {
    const padre = rutaPaquete(el.paquete);
    asegurarPaquete(padre);
    const ruta = `${padre}/${el.nombre.replace(/\//g, '-')}`;
    el.clave = `objpkg:${ruta}`;
    asegurarPaquete(ruta, el);
  } else {
    asegurarPaquete(rutaPaquete(el.paquete));
  }
}

// Diagramas (antes que los elementos: fragmentos y marcos guardan el id del diagrama)
for (const diag of diagramas) {
  const clavePaquete = `pkg:${rutaPaquete(diag.paquete)}`;
  pasos.push({ accion: 'avisar', tabla: 't_diagram', donde: { Name: diag.nombre, Package_ID: ref(clavePaquete) }, columnaId: 'Diagram_ID', mensaje: `ya existia un diagrama "${diag.nombre}" en ese paquete; se agrega otro` });
  pasos.push({
    accion: 'insertar', tabla: 't_diagram', columnaId: 'Diagram_ID', clave: diag.clave,
    valores: {
      Package_ID: ref(clavePaquete), ParentID: 0, Diagram_Type: diag.tipoEA, Name: diag.nombre, Version: '1.0',
      Author: AUTOR, ShowDetails: 0, ...(diag.nota ? { Notes: String(diag.nota) } : {}), AttPub: true, AttPri: true, AttPro: true,
      Orientation: 'P', cx: 827, cy: 1169, Scale: 100, CreatedDate: ahora, ModifiedDate: ahora,
      ShowForeign: true, ShowBorder: true, ShowPackageContents: true, PDATA: PDATA_DIAGRAMA, Locked: false,
      ea_guid: diag.guid, TPos: 0, Swimlanes: SWIMLANES, StyleEx: estiloDiagrama(diag.tipoEA),
    },
  });
}

// Elementos (los contenedores con ParentID real antes que sus hijos)
const insertados = new Set();
function insertarElemento(id) {
  if (insertados.has(id)) return;
  const el = elementos.get(id);
  insertados.add(id);
  if (el.tipo === 'paquete') return; // ya creado como paquete
  if (el.padre) insertarElemento(el.padre);
  const r = el.receta;
  const clavePaquete = `pkg:${rutaPaquete(el.paquete)}`;
  const valores = {
    Object_Type: r.ot, ...COMUN_OBJETO(AUTOR), GenType: r.gen, Package_ID: ref(clavePaquete), ea_guid: el.guid,
    NType: r.ntype ?? 0, BorderStyle: r.borde ?? 0, ...(r.extra || {}),
  };
  if (el.nombre) valores.Name = texto255(el.nombre);
  if (el.alias) valores.Alias = texto255(el.alias);
  if (el.estereotipo) valores.Stereotype = texto255(el.estereotipo);
  if (el.nota) valores.Note = String(el.nota);
  if (el.abstracta) valores.Abstract = '1';
  if (el.padre) valores.ParentID = ref(elementos.get(el.padre).clave);
  if (el.reutilizar) {
    pasos.push({
      accion: 'buscar', tabla: 't_object', columnaId: 'Object_ID', columnaGuid: 'ea_guid', clave: el.clave,
      donde: { Object_Type: r.ot, Name: valores.Name ?? null, ...(el.estereotipo ? { Stereotype: el.estereotipo } : {}) },
    });
  }
  pasos.push({ accion: 'insertar', siNoExiste: el.clave, tabla: 't_object', columnaId: 'Object_ID', clave: el.clave, valores });
  if (el.estereotipo) pasos.push(xrefEstereotipo(el.clave, el.estereotipo, 'element property'));
  el.atributos.forEach((a, pos) => pasos.push({
    accion: 'insertar', soloSiNuevo: el.clave, tabla: 't_attribute',
    valores: {
      Object_ID: ref(el.clave), Name: texto255(a.nombre), Scope: a.scope, Containment: 'Not Specified',
      IsStatic: a.estatico ? 1 : 0, IsCollection: 0, IsOrdered: 0, AllowDuplicates: 0, LowerBound: '1', UpperBound: '1',
      Pos: pos, Classifier: '0', Type: texto255(a.tipo), ea_guid: guid(), StyleEx: 'volatile=0;',
      ...(a.valor != null ? { Default: String(a.valor) } : {}),
    },
  }));
  el.operaciones.forEach((o, pos) => {
    const claveOp = `op:${id}:${pos}`;
    const g = guid();
    pasos.push({
      accion: 'insertar', soloSiNuevo: el.clave, tabla: 't_operation', columnaId: 'OperationID', clave: claveOp,
      valores: {
        Object_ID: ref(el.clave), Name: texto255(o.nombre), Scope: o.scope, Type: texto255(o.retorno || 'void'),
        ReturnArray: '0', IsStatic: o.estatica ? '1' : '0', Concurrency: 'Sequential', Abstract: o.abstracta ? '1' : '0',
        Synchronized: '0', Pos: pos, Const: 0, Pure: false, Classifier: '0', IsRoot: false, IsLeaf: false, IsQuery: false, ea_guid: g,
      },
    });
    o.parametros.forEach((p, n) => pasos.push({
      accion: 'insertar', soloSiNuevo: el.clave, tabla: 't_operationparams',
      valores: { OperationID: ref(claveOp), Name: texto255(p.nombre), Type: texto255(p.tipo), Pos: n, Const: false, Kind: 'in', Classifier: '0', ea_guid: guid() },
    }));
  });
}
for (const id of ordenElementos) insertarElemento(id);

// Fragmentos de secuencia y marcos de índice (elementos propios de un diagrama)
for (const diag of diagramas) {
  const clavePaquete = `pkg:${rutaPaquete(diag.paquete)}`;
  for (const f of diag.fragmentos) {
    pasos.push({
      accion: 'insertar', tabla: 't_object', columnaId: 'Object_ID', clave: f.clave,
      valores: {
        Object_Type: 'InteractionFragment', ...COMUN_OBJETO(AUTOR), GenType: '<none>', Package_ID: ref(clavePaquete),
        ...(f.condicion ? { Name: f.condicion } : {}), NType: FRAGMENTOS[f.operador], BorderStyle: 3,
        PDATA1: refTexto(diag.clave), ea_guid: f.guid,
      },
    });
  }
  for (const m of diag.marcos || []) {
    pasos.push({
      accion: 'insertar', tabla: 't_object', columnaId: 'Object_ID', clave: m.clave,
      valores: {
        Object_Type: 'UMLDiagram', ...COMUN_OBJETO(AUTOR), GenType: '<none>', Package_ID: ref(clavePaquete),
        Name: m.nombre, BorderStyle: 3, PDATA1: refTexto(m.destino), ea_guid: m.guid,
      },
    });
  }
}

// Ubicación en el lienzo (t_diagramobjects). RectTop/RectBottom van en negativo, como en EA.
// Orden (Sequence, 1 = al frente): contenedores (límites, paquetes, nodos) detrás y, entre ellos,
// los más grandes más atrás; en secuencia los fragmentos van delante de las líneas de vida.
const orden = (el, p) => (el.receta.contenedor ? 1e9 : 0) + p.w * p.h;
const conteo = { diagramas: diagramas.length, elementos: 0, relaciones: 0, mensajes: 0 };
for (const diag of diagramas) {
  diag.duid = new Map();
  const filas = [];
  for (const f of diag.fragmentos) filas.push({ clave: f.clave, pos: f.pos, estilo: '', orden: -1 });
  for (const m of diag.marcos || []) filas.push({ clave: m.clave, pos: m.pos, estilo: '', orden: 0 });
  for (const id of diag.ids) {
    const el = elementos.get(id);
    const p = diag.pos.get(id);
    if (!p) { avisos.push(`${diag.contexto}: "${el.nombre}" quedó sin posición`); continue; }
    let estilo = '';
    if (el.receta.etiqueta) estilo += ETIQUETA_NODO;
    const bcol = colorEA(el.color);
    if (bcol != null) estilo += `BCol=${bcol};`;
    filas.push({ clave: el.clave, id, pos: p, estilo, paquete: el.tipo === 'paquete', orden: diag.tipo === 'secuencia' ? p.w : orden(el, p) });
  }
  // Sequence: 1 = al frente. Hojas primero, contenedores detrás.
  filas.sort((a, b) => a.orden - b.orden);
  filas.forEach((f, i) => {
    const d = duid();
    if (f.id) diag.duid.set(f.id, d);
    pasos.push({
      accion: 'insertar', tabla: 't_diagramobjects',
      valores: {
        Diagram_ID: ref(diag.clave), Object_ID: ref(f.clave), RectTop: -f.pos.y, RectLeft: f.pos.x,
        RectRight: f.pos.x + f.pos.w, RectBottom: -(f.pos.y + f.pos.h), Sequence: i + 1,
        ObjectStyle: `${f.paquete ? ' ' : ''}DUID=${d};${f.estilo}`,
      },
    });
  });
  conteo.elementos += filas.length;
}

// Relaciones: una fila por relación distinta; una línea por diagrama donde aparece
const relacionesUnicas = new Map();
const bordeLinea = (pa, pb) => {
  const dx = pb.x + pb.w / 2 - (pa.x + pa.w / 2), dy = pb.y + pb.h / 2 - (pa.y + pa.h / 2);
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 2 : 4) : (dy >= 0 ? 3 : 1);
};
const ocultarAlFinal = [];
for (const diag of diagramas) {
  // Relaciones entre el mismo par de elementos (ida y vuelta, o de distinto tipo): líneas paralelas
  const pares = new Map();
  for (const r of diag.relaciones) {
    const kp = [r.desde, r.hacia].sort().join('|');
    if (!pares.has(kp)) pares.set(kp, []);
    pares.get(kp).push(r);
  }
  for (const r of diag.relaciones) {
    const grupo = pares.get([r.desde, r.hacia].sort().join('|'));
    const desplazamiento = grupo.length > 1 ? Math.round((grupo.indexOf(r) - (grupo.length - 1) / 2) * diag.separacionParalelas) : 0;
    const k = `${r.tipo}|${r.desde}|${r.hacia}|${normalizar(r.nombre ?? r.etiqueta ?? '')}|${normalizar(r.estereotipo ?? '')}`;
    let unica = relacionesUnicas.get(k);
    if (!unica) {
      unica = { ...r, guid: guid(), clave: `con:${relacionesUnicas.size}` };
      relacionesUnicas.set(k, unica);
      const ea = elementos.get(r.desde), eb = elementos.get(r.hacia);
      const valores = valoresRelacion(unica, ea.receta.ot, eb.receta.ot);
      valores.Start_Object_ID = ref(ea.clave);
      valores.End_Object_ID = ref(eb.clave);
      if ((ea.reutilizar || eb.reutilizar) && unica.tipo !== 'nota') {
        pasos.push({
          accion: 'buscar', siAmbosExistentes: [ea.clave, eb.clave], tabla: 't_connector', columnaId: 'Connector_ID', columnaGuid: 'ea_guid', clave: unica.clave,
          donde: { Connector_Type: valores.Connector_Type, Start_Object_ID: ref(ea.clave), End_Object_ID: ref(eb.clave) },
        });
      }
      pasos.push({ accion: 'insertar', siNoExiste: unica.clave, tabla: 't_connector', columnaId: 'Connector_ID', clave: unica.clave, valores });
      if (valores.Stereotype) pasos.push(xrefEstereotipo(unica.clave, valores.Stereotype, 'connector property'));
      conteo.relaciones++;
    }
    const pa = diag.pos.get(r.desde), pb = diag.pos.get(r.hacia);
    const sd = diag.duid.get(r.desde), ed = diag.duid.get(r.hacia);
    if (!pa || !pb || !sd || !ed) continue;
    pasos.push({
      accion: 'insertar', tabla: 't_diagramlinks',
      valores: { DiagramID: ref(diag.clave), ConnectorID: ref(unica.clave), Geometry: GEOMETRIA_LINEA(bordeLinea(pa, pb), desplazamiento), Style: ESTILO_LINEA(sd, ed), Hidden: false },
    });
  }
  if (diag.tipo !== 'secuencia' && diag.tipo !== 'indice' && !diag.mostrarRelacionesExistentes) {
    ocultarAlFinal.push({ accion: 'ocultarNoListados', diagrama: diag.clave });
  }
}
// Ocultar recién cuando existen todos los conectores: una relación que define un diagrama posterior
// (p. ej. otro caso de uso) también debe quedar oculta en los diagramas anteriores que no la listan.
pasos.push(...ocultarAlFinal);

// Mensajes de secuencia: pertenecen a un diagrama (DiagramID) y no llevan fila en t_diagramlinks
for (const diag of diagramas) {
  diag.mensajes.forEach((m, i) => {
    const p = diag.posMensajes[i];
    pasos.push({
      accion: 'insertar', tabla: 't_connector',
      valores: {
        ...COMUN_CONECTOR, Name: m.nombre, Direction: 'Source -> Destination', Connector_Type: 'Sequence',
        Start_Object_ID: ref(elementos.get(m.desde).clave), End_Object_ID: ref(elementos.get(m.hacia).clave),
        Start_Edge: p.se, End_Edge: p.ee, PtStartX: Math.round(p.sx), PtStartY: -Math.round(p.sy),
        PtEndX: Math.round(p.ex), PtEndY: -Math.round(p.ey), SeqNo: i + 1, RouteStyle: 1, VirtualInheritance: '0',
        PDATA1: m.asincrono ? 'Asynchronous' : 'Synchronous', PDATA2: 'retval=void;', PDATA3: 'Call', PDATA4: '0',
        PDATA5: 'SX=0;SY=0;EX=0;EY=0;$LLB=;LLT=;LMT=;LMB=;LRT=;LRB=;IRHS=;ILHS=;',
        DiagramID: ref(diag.clave), ea_guid: guid(), ...navegabilidad('Non-Navigable', 'Navigable'),
      },
    });
    conteo.mensajes++;
  });
}

// Los .EAP de EA 13.5 son Jet 3: el texto se guarda en la página de códigos Windows-1252 y lo que
// no exista ahí (→, ✓, emojis…) queda como "?" al abrirlo en EA.
const EXTRA_1252 = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const fuera1252 = new Set();
for (const paso of pasos) {
  for (const valor of Object.values(paso.valores ?? {})) {
    if (typeof valor !== 'string') continue;
    for (const c of valor) {
      const n = c.codePointAt(0);
      if ((n > 0xff || (n >= 0x80 && n <= 0x9f)) && !EXTRA_1252.has(c)) fuera1252.add(c);
    }
  }
}
if (fuera1252.size) avisos.push(`caracteres que EA mostrará como "?" (fuera de Windows-1252): ${[...fuera1252].join(' ')} — reemplázalos (p. ej. → por ->)`);

const plan = {
  version: 1,
  generadoPor: 'preparar-plan.mjs',
  especificacion: archivoSpec,
  modelo: MODELO,
  resumen: {
    ...conteo,
    detalle: diagramas.map((d) => ({ nombre: d.nombre, tipo: d.tipo, tipoEA: d.tipoEA, paquete: rutaPaquete(d.paquete), elementos: d.ids.length, relaciones: d.relaciones.length, mensajes: d.mensajes.length, fragmentos: d.fragmentos.length })),
  },
  avisos,
  pasos,
};
writeFileSync(archivoPlan, JSON.stringify(plan, null, 1));
console.log(`Plan listo: ${archivoPlan}`);
console.log(`  ${conteo.diagramas} diagramas · ${elementos.size} elementos · ${conteo.relaciones} relaciones · ${conteo.mensajes} mensajes · ${pasos.length} pasos`);
for (const d of plan.resumen.detalle) console.log(`  - [${d.tipoEA}] ${d.paquete} / ${d.nombre}: ${d.elementos} elementos, ${d.relaciones} relaciones${d.mensajes ? `, ${d.mensajes} mensajes` : ''}${d.fragmentos ? `, ${d.fragmentos} fragmentos` : ''}`);
if (avisos.length) { console.log('Avisos:'); for (const a of avisos) console.log(`  - ${a}`); }
