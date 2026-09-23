import { archivoServicio, claseServicio } from './FlutterNombres.js';
import {
    archivoDart, atributoDescriptivo, atributosDTO, campoJava, claveDeAtributo, claveMuchosAMuchos,
    esHora, esSoloFecha, etiquetaCampo, identificadorDart, largoMaximo, muchosAMuchosPropios,
    nombreClase, pkDe, referenciasConOpciones, textoDart, tipoDart
} from './FlutterNombres.js';

/**
 * Pantallas Flutter: inicio, listado y formulario por entidad.
 *
 * Los formularios validan lo mismo que exige el backend (campos obligatorios,
 * números no negativos, la FK de una composición) para no llegar a un 400.
 * Antes pedían escribir el ID a mano, sus validadores eran "if (false && ...)"
 * y los booleanos y fechas se escribían como texto libre.
 */
class FlutterScreenGenerator {
    constructor(entities = [], relationships = [], entidadesConApi = entities, politica = null) {
        this.entities = entities;
        this.relationships = relationships;
        this.entidadesConApi = entidadesConApi;
        this.politica = politica;
    }

    permiso(modulo, accion) {
        // Sin política declarada, el backend permite configurar gestores en application.properties.
        // La sesión contiene el valor vigente; una tabla deducida al exportar podría quedar obsoleta.
        if (this.politica?.explicito !== true && accion !== 'ver') return 'AuthService.puedeGestionar';
        return `permisos.Permisos.puede(AuthService.rol, '${textoDart(modulo)}', '${accion}')`;
    }

    atributos(entity) {
        return atributosDTO(entity, this.entities, this.relationships);
    }

    campoPk(entity) {
        const pk = pkDe(entity, this.entities, this.relationships);
        return pk
            ? { nombre: identificadorDart(claveDeAtributo(pk)), tipo: tipoDart(pk.type) }
            : { nombre: 'id', tipo: 'int' };
    }

    campo(attr) {
        return identificadorDart(claveDeAtributo(attr));
    }

    /** "Origen (Paradas)" cuando la FK no se llama como la entidad a la que apunta */
    etiquetaDe(attr) {
        const etiqueta = attr.etiqueta || etiquetaCampo(claveDeAtributo(attr));
        if (!attr.isForeignKey || campoJava(attr.name) === campoJava(attr.referencedEntity)) return etiqueta;
        return `${etiqueta} (${etiquetaCampo(attr.referencedEntity)})`;
    }

    /** Texto de una opción de un desplegable: "3 - Lácteos" */
    etiquetaOpcion(variable, refEntity) {
        const pk = this.campoPk(refEntity);
        const descriptivo = atributoDescriptivo(this.atributos(refEntity));
        if (descriptivo) {
            return `'\${${variable}.${pk.nombre}} - \${${variable}.${this.campo(descriptivo)} ?? ''}'`;
        }
        return `'${textoDart(etiquetaCampo(refEntity.name))} #\${${variable}.${pk.nombre}}'`;
    }

    generateHomeScreen(nombreApp) {
        const entidades = this.entidadesConApi;
        const imports = [
            "import 'asistente_screen.dart';",
            "import 'login_screen.dart';",
            "import '../services/auth_service.dart';",
            "import '../config/permisos.dart' as permisos;",
            ...entidades.map(e => `import '${archivoDart(e.name)}_list_screen.dart';`)
        ].join('\n');
        const entradas = entidades.map(e =>
            `      if (${this.permiso(e.name, 'ver')}) _Entrada('${textoDart(etiquetaCampo(e.name))}', () => const ${nombreClase(e.name)}ListScreen()),`
        ).join('\n');
        return `import 'package:flutter/material.dart';

${imports}

/// Pantalla principal: una entrada por cada entidad con API en el backend.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final entradas = <_Entrada>[
      if (permisos.Permisos.puedeUsarAsistente(AuthService.rol))
        _Entrada('Asistente', () => const AsistenteScreen(), asistente: true),
${entradas}
    ];
    return Scaffold(
      appBar: AppBar(
        title: const Text('${textoDart(nombreApp)}'),
        actions: [
          if (AuthService.haySesion)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Center(
                child: Text(
                  '\${AuthService.nombre ?? AuthService.correo ?? ''} · \${AuthService.rol ?? ''}',
                  style: Theme.of(context).textTheme.labelMedium,
                ),
              ),
            ),
          IconButton(
            tooltip: 'Cerrar sesión',
            icon: const Icon(Icons.logout),
            onPressed: () async {
              await AuthService.cerrarSesion();
              if (!context.mounted) return;
              Navigator.pushAndRemoveUntil(
                context,
                MaterialPageRoute(builder: (context) => const LoginScreen()),
                (ruta) => false,
              );
            },
          ),
        ],
      ),
      body: Column(children: [
        if (AuthService.vinculacionPendiente && permisos.Permisos.requiereVinculacion(AuthService.rol))
          const Padding(padding: EdgeInsets.all(16), child: Text('Tu cuenta está pendiente de vinculación. Contacta a quien administra.')),
        Expanded(child: entradas.isEmpty ? const Center(child: Text('Tu rol no tiene módulos habilitados.')) : ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: entradas.length,
        separatorBuilder: (context, index) => const SizedBox(height: 8),
        itemBuilder: (context, index) {
          final entrada = entradas[index];
          return Card(
            color: entrada.asistente ? Theme.of(context).colorScheme.primaryContainer : null,
            child: ListTile(
              leading: Icon(entrada.asistente ? Icons.smart_toy : Icons.view_list),
              title: Text(entrada.titulo),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (context) => entrada.pantalla()),
              ),
            ),
          );
        },
        )),
      ]),
    );
  }
}

class _Entrada {
  final String titulo;
  final Widget Function() pantalla;
  final bool asistente;

  const _Entrada(this.titulo, this.pantalla, {this.asistente = false});
}
`;
    }

    generateListScreen(entity) {
        const clase = nombreClase(entity.name);
        const archivo = archivoDart(entity.name);
        const titulo = textoDart(etiquetaCampo(entity.name));
        const pk = this.campoPk(entity);
        const atributos = this.atributos(entity);
        const descriptivo = atributoDescriptivo(atributos);
        const otros = atributos.filter(a => !a.isPrimaryKey && !a.isForeignKey && !a.oculto && a !== descriptivo).slice(0, 2);

        // El atributo descriptivo siempre es String: se usa directo, sin interpolar
        const textoTitulo = descriptivo
            ? `registro.${this.campo(descriptivo)} ?? '-'`
            : `'${titulo} #\${registro.${pk.nombre}}'`;
        // Una fecha cruda se ve como "2026-09-14 00:00:00.000": en la lista va en formato corto
        const hayFechas = otros.some(a => tipoDart(a.type) === 'DateTime');
        const partes = [
            `ID: \${registro.${pk.nombre}}`,
            ...otros.map((a) => {
                const etiqueta = textoDart(a.etiqueta || etiquetaCampo(claveDeAtributo(a)));
                const valor = tipoDart(a.type) === 'DateTime'
                    ? `\${_fechaCorta(registro.${this.campo(a)}, ${esSoloFecha(a.type)})}`
                    : `\${registro.${this.campo(a)} ?? '-'}`;
                return `${etiqueta}: ${valor}`;
            })
        ];
        const textoSubtitulo = `'${partes.join(' · ')}'`;
        const ayudaFecha = !hayFechas ? '' : `
  /// Fecha en formato corto para la lista: 14/09/2026 (con la hora solo si el campo la lleva).
  String _fechaCorta(DateTime? valor, bool soloFecha) {
    if (valor == null) return '-';
    String dos(int numero) => numero.toString().padLeft(2, '0');
    final dia = '\${dos(valor.day)}/\${dos(valor.month)}/\${valor.year}';
    return soloFecha ? dia : '\$dia \${dos(valor.hour)}:\${dos(valor.minute)}';
  }
`;

        return `import 'dart:async';
import 'package:flutter/material.dart';

import '../models/${archivo}.dart';
import '../services/${archivoServicio(entity.name)}.dart';
import '../services/auth_service.dart';
import '../config/permisos.dart' as permisos;
import '${archivo}_form_screen.dart';

class ${clase}ListScreen extends StatefulWidget {
  const ${clase}ListScreen({super.key});

  @override
  State<${clase}ListScreen> createState() => _${clase}ListScreenState();
}

class _${clase}ListScreenState extends State<${clase}ListScreen> {
  final ${claseServicio(entity.name)} _service = ${claseServicio(entity.name)}();
  final List<${clase}> _registros = [];
  final _scroll = ScrollController();
  Timer? _espera;
  String _busqueda = '';
  String? _error;
  int _pagina = 0;
  int _solicitud = 0;
  bool _hayMas = true;
  bool _cargando = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_alDesplazar);
    _cargar();
  }

  @override
  void dispose() {
    _espera?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  void _alDesplazar() {
    if (_scroll.hasClients && _scroll.position.extentAfter < 300 && _error == null) _cargar();
  }

  void _buscar(String texto) {
    _espera?.cancel();
    _solicitud++;
    setState(() {
      _busqueda = texto.trim();
      _registros.clear();
      _cargando = true;
      _hayMas = false;
      _error = null;
    });
    _espera = Timer(const Duration(milliseconds: 400), _recargar);
  }

  void _recargar() {
    if (!mounted) return;
    _espera?.cancel();
    _solicitud++;
    _pagina = 0;
    _hayMas = true;
    _cargando = false;
    _registros.clear();
    _cargar();
  }

  Future<void> _cargar() async {
    if (!${this.permiso(entity.name, 'ver')}) {
      if (mounted) setState(() { _error = 'Tu rol no puede consultar este módulo.'; _hayMas = false; _cargando = false; });
      return;
    }
    if (!mounted || _cargando || !_hayMas) return;
    final solicitud = ++_solicitud;
    setState(() { _cargando = true; _error = null; });
    try {
      final resultado = await _service.getPagina(pagina: _pagina, buscar: _busqueda);
      if (!mounted || solicitud != _solicitud) return;
      setState(() {
        _registros.addAll(resultado.items);
        _pagina = resultado.pagina + 1;
        _hayMas = resultado.hayMas;
      });
    } catch (e) {
      if (mounted && solicitud == _solicitud) setState(() => _error = '$e');
    } finally {
      if (mounted && solicitud == _solicitud) {
        setState(() => _cargando = false);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _alDesplazar();
        });
      }
    }
  }

  void _mostrar(String mensaje) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(mensaje)));
  }

  Future<void> _abrirFormulario([${clase}? registro]) async {
    if (registro == null ? !${this.permiso(entity.name, 'crear')} : !${this.permiso(entity.name, 'ver')}) return;
    final guardado = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (context) => ${clase}FormScreen(registro: registro)),
    );
    if (guardado == true) _recargar();
  }

  Future<void> _eliminar(${clase} registro) async {
    if (!${this.permiso(entity.name, 'borrar')}) return;
    final id = registro.${pk.nombre};
    if (id == null) return;
    final confirmado = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Eliminar registro'),
        content: const Text('¿Seguro que deseas eliminar este registro?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Eliminar')),
        ],
      ),
    );
    if (confirmado != true) return;
    try {
      await _service.delete(id);
      if (!mounted) return;
      _mostrar('Registro eliminado');
      _recargar();
    } catch (e) {
      if (!mounted) return;
      _mostrar('$e');
    }
  }
${ayudaFecha}
  Widget _contenido() {
    if (_registros.isEmpty) {
      if (_cargando) return const Center(child: CircularProgressIndicator());
      return Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(_error ?? (_busqueda.isEmpty ? 'Todavía no hay registros' : 'No hay resultados para «$_busqueda»'), textAlign: TextAlign.center),
          if (_error != null) FilledButton(onPressed: _recargar, child: const Text('Reintentar')),
        ],
      )));
    }
    return ListView.separated(
      controller: _scroll,
      padding: const EdgeInsets.all(8),
      itemCount: _registros.length + (_hayMas || _error != null ? 1 : 0),
      separatorBuilder: (context, index) => const Divider(height: 1),
      itemBuilder: (context, index) {
        if (index == _registros.length) {
          return Padding(padding: const EdgeInsets.all(16), child: Center(
            child: _error != null
              ? Column(children: [Text(_error!), TextButton(onPressed: _cargar, child: const Text('Reintentar'))])
              : const CircularProgressIndicator(),
          ));
        }
        final registro = _registros[index];
        return ListTile(
          title: Text(${textoTitulo}),
          subtitle: Text(${textoSubtitulo}),
          onTap: () => _abrirFormulario(registro),
          trailing: !${this.permiso(entity.name, 'borrar')} ? null : IconButton(
            icon: const Icon(Icons.delete_outline), tooltip: 'Eliminar',
            onPressed: () => _eliminar(registro),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('${titulo}'),
        actions: [
          IconButton(onPressed: _recargar, icon: const Icon(Icons.refresh), tooltip: 'Recargar'),
        ],
      ),
      floatingActionButton: !${this.permiso(entity.name, 'crear')} ? null : FloatingActionButton(
        onPressed: () => _abrirFormulario(),
        tooltip: 'Nuevo',
        child: const Icon(Icons.add),
      ),
      body: Column(children: [
        Padding(padding: const EdgeInsets.all(12), child: TextField(
          decoration: const InputDecoration(labelText: 'Buscar', prefixIcon: Icon(Icons.search), border: OutlineInputBorder()),
          onChanged: _buscar,
        )),
        Expanded(child: _contenido()),
      ]),
    );
  }
}
`;
    }

    generateFormScreen(entity) {
        const clase = nombreClase(entity.name);
        const archivo = archivoDart(entity.name);
        const titulo = textoDart(etiquetaCampo(entity.name));
        const pk = this.campoPk(entity);
        const conApi = new Set(this.entidadesConApi.map(e => e.name));
        const buscar = (nombre) => this.entities.find(e => e.name === nombre);

        const campos = this.atributos(entity).filter(a => !a.isPrimaryKey).toSorted((a, b) => (a.orden ?? Infinity) - (b.orden ?? Infinity)).map(a => {
            const tipo = tipoDart(a.type);
            let control;
            if (a.isForeignKey && conApi.has(a.referencedEntity)) control = 'fk';
            else if (a.isForeignKey || tipo === 'int') control = 'entero';
            else if (tipo === 'bool') control = 'bool';
            else if (tipo === 'DateTime') control = 'fecha';
            else if (esHora(a.type)) control = 'hora';
            else if (tipo === 'double') control = 'decimal';
            else control = 'texto';
            return {
                nombre: this.campo(a),
                control,
                soloFecha: esSoloFecha(a.type),
                largo: largoMaximo(a),
                etiqueta: textoDart(this.etiquetaDe(a)),
                ref: a.isForeignKey ? buscar(a.referencedEntity) : null,
                // Los atributos los exige el backend; una FK solo si es de composición
                oculto: a.oculto,
                minimo: a.minimo, maximo: a.maximo,
                obligatorio: a.isForeignKey ? a.isRequired === true : a.obligatorio !== false
            };
        });
        const muchos = muchosAMuchosPropios(entity, this.entities, this.relationships)
            .filter(o => conApi.has(o.name))
            .map(o => ({
                nombre: identificadorDart(claveMuchosAMuchos(o)),
                control: 'muchos',
                etiqueta: textoDart(`${etiquetaCampo(o.name)}s`),
                ref: o
            }));
        const todos = [...campos, ...muchos];
        const visibles = todos.filter(c => !c.oculto);
        const referencias = referenciasConOpciones(entity, this.entities, this.relationships, this.entidadesConApi)
            .filter(r => visibles.some(c => c.ref?.name === r.name));
        const usaFechas = visibles.some(c => c.control === 'fecha');
        const usaHoras = visibles.some(c => c.control === 'hora');
        const conControlador = visibles.filter(c => ['texto', 'entero', 'decimal', 'fecha', 'hora'].includes(c.control));

        const imports = [
            `import '../models/${archivo}.dart';`,
            ...referencias.filter(r => r.name !== entity.name).map(r => `import '../models/${archivoDart(r.name)}.dart';`),
            `import '../services/${archivoServicio(entity.name)}.dart';`,
            // El formulario consulta el rol para no ofrecer guardar a quien solo consulta
            "import '../services/auth_service.dart';",
            "import '../config/permisos.dart' as permisos;",
            ...(referencias.length ? ["import '../services/base_service.dart' as base;"] : [])
        ].join('\n');

        const estado = [
            ...conControlador.map(c => `  final _${c.nombre}Ctrl = TextEditingController();`),
            ...visibles.filter(c => c.control === 'bool').map(c => `  bool _${c.nombre} = false;`),
            ...visibles.filter(c => c.control === 'fk').map(c => `  ${this.campoPk(c.ref).tipo}? _${c.nombre};`),
            ...muchos.map(c => `  Set<${this.campoPk(c.ref).tipo}> _${c.nombre} = {};`),
            ...referencias.map(r => `  List<${nombreClase(r.name)}> _opciones${nombreClase(r.name)} = [];\n  bool _hayMas${nombreClase(r.name)} = false;`),
            ...(referencias.length ? ['  bool _cargandoOpciones = true;', '  String? _errorOpciones;'] : [])
        ].join('\n');

        const cargas = visibles.map(c => {
            switch (c.control) {
                case 'texto':
                case 'hora': return `      _${c.nombre}Ctrl.text = registro.${c.nombre} ?? '';`;
                case 'entero':
                case 'decimal': return `      _${c.nombre}Ctrl.text = registro.${c.nombre}?.toString() ?? '';`;
                case 'fecha': return `      final ${c.nombre} = registro.${c.nombre};\n      _${c.nombre}Ctrl.text = ${c.nombre} == null ? '' : _textoFecha(${c.nombre}, soloFecha: ${c.soloFecha});`;
                case 'bool': return `      _${c.nombre} = registro.${c.nombre} ?? false;`;
                case 'fk': return `      _${c.nombre} = registro.${c.nombre};`;
                case 'muchos': return `      _${c.nombre} = {...?registro.${c.nombre}};`;
                default: return '';
            }
        }).join('\n');

        const cargarOpciones = referencias.length ? `
  Future<void> _cargarOpciones() async {
    if (widget.registro != null && !${this.permiso(entity.name, 'ver')}) {
      setState(() => _cargandoOpciones = false);
      return;
    }
    setState(() { _cargandoOpciones = true; _errorOpciones = null; });
    try {
${referencias.map(r => {
    const ref = nombreClase(r.name);
    const pkRef = this.campoPk(r);
    const relaciones = visibles.filter(c => c.ref?.name === r.name);
    return `      final consulta${ref} = ${this.permiso(r.name, 'ver')};
      final pagina${ref} = consulta${ref}
          ? await _service.get${ref}Pagina()
          : const base.Pagina<${ref}>(items: [], total: 0, pagina: 0, hayMas: false);
      final opciones${ref} = [...pagina${ref}.items];
      final seleccionados${ref} = <${pkRef.tipo}>{${relaciones.map(c => c.control === 'muchos' ? `..._${c.nombre}` : `if (_${c.nombre} != null) _${c.nombre}!`).join(', ')}};
      if (consulta${ref}) {
        for (final id in seleccionados${ref}) {
          if (opciones${ref}.any((o) => o.${pkRef.nombre} == id)) continue;
          try {
            opciones${ref}.add(await _service.get${ref}OpcionPorId(id));
          } on base.ApiException catch (e) {
            // Un vínculo ya guardado puede apuntar fuera del ámbito visible: conservar su ID.
            if (e.status != 403 && e.status != 404) rethrow;
          }
        }
      }`;
}).join('\n')}
      if (!mounted) return;
      setState(() {
${referencias.map(r => `        _opciones${nombreClase(r.name)} = opciones${nombreClase(r.name)};\n        _hayMas${nombreClase(r.name)} = pagina${nombreClase(r.name)}.hayMas;`).join('\n')}
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _errorOpciones = 'No se pudieron cargar las opciones: $e');
    } finally {
      if (mounted) setState(() => _cargandoOpciones = false);
    }
  }
${visibles.filter(c => ['fk', 'muchos'].includes(c.control)).map(c => {
    const ref = nombreClase(c.ref.name);
    const pkRef = this.campoPk(c.ref);
    return `
  Future<void> _elegir${c.nombre}() async {
    if (!_puedeModificar || !${this.permiso(c.ref.name, 'ver')}) return;
${c.control === 'muchos' ? `    final noConsultables = _${c.nombre}.where((id) => !_opciones${ref}.any((o) => o.${pkRef.nombre} == id)).toSet();` : ''}
    final elegidos = await showDialog<List<${ref}>>(
      context: context,
      builder: (context) => _SelectorRelacion<${ref}, ${pkRef.tipo}>(
        titulo: '${c.etiqueta}', multiple: ${c.control === 'muchos'},
        cargar: (pagina, buscar) => _service.get${ref}Pagina(pagina: pagina, buscar: buscar),
        idDe: (o) => o.${pkRef.nombre}, etiqueta: (o) => ${this.etiquetaOpcion('o', c.ref)},
        seleccionados: _opciones${ref}.where((o) => ${c.control === 'muchos' ? `_${c.nombre}.contains(o.${pkRef.nombre})` : `o.${pkRef.nombre} == _${c.nombre}`}).toList(),
      ),
    );
    if (!mounted || elegidos == null || !_puedeModificar || !${this.permiso(c.ref.name, 'ver')}) return;
    setState(() {
      for (final opcion in elegidos) {
        if (!_opciones${ref}.any((o) => o.${pkRef.nombre} == opcion.${pkRef.nombre})) _opciones${ref}.add(opcion);
      }
      _${c.nombre} = ${c.control === 'muchos' ? `{...noConsultables, ...elegidos.map((o) => o.${pkRef.nombre}!)}` : `elegidos.isEmpty ? null : elegidos.first.${pkRef.nombre}`};
    });
  }
`;
}).join('')}
` : '';

        const ayudaFechas = usaFechas ? `
  Future<void> _elegirFecha(TextEditingController controlador, {required bool soloFecha}) async {
    if (!_puedeModificar) return;
    final actual = DateTime.tryParse(controlador.text) ?? DateTime.now();
    final fecha = await showDatePicker(
      context: context,
      initialDate: actual,
      firstDate: DateTime(1900),
      lastDate: DateTime(2100),
    );
    if (fecha == null) return;
    if (!mounted) return;
    var elegida = fecha;
    if (!soloFecha) {
      final hora = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(actual));
      if (!mounted) return;
      elegida = DateTime(fecha.year, fecha.month, fecha.day, hora?.hour ?? actual.hour, hora?.minute ?? actual.minute);
    }
    setState(() => controlador.text = _textoFecha(elegida, soloFecha: soloFecha));
  }

  String _textoFecha(DateTime fecha, {required bool soloFecha}) {
    final texto = fecha.toIso8601String().split('.').first;
    return soloFecha ? texto.substring(0, 10) : texto;
  }
` : '';

        // LocalTime: el backend recibe y devuelve "HH:mm:ss"
        const ayudaHoras = usaHoras ? `
  Future<void> _elegirHora(TextEditingController controlador) async {
    if (!_puedeModificar) return;
    final partes = controlador.text.split(':');
    final actual = partes.length >= 2
        ? TimeOfDay(hour: int.tryParse(partes[0]) ?? 0, minute: int.tryParse(partes[1]) ?? 0)
        : TimeOfDay.now();
    final hora = await showTimePicker(context: context, initialTime: actual);
    if (hora == null || !mounted) return;
    String dosDigitos(int valor) => valor.toString().padLeft(2, '0');
    setState(() => controlador.text = '\${dosDigitos(hora.hour)}:\${dosDigitos(hora.minute)}:00');
  }
` : '';

        const asignaciones = todos.map(c => {
            if (c.oculto) return `      ${c.nombre}: widget.registro?.${c.nombre},`;
            switch (c.control) {
                case 'texto':
                case 'hora': return `      ${c.nombre}: _${c.nombre}Ctrl.text.trim().isEmpty ? null : _${c.nombre}Ctrl.text.trim(),`;
                case 'entero': return `      ${c.nombre}: int.tryParse(_${c.nombre}Ctrl.text.trim()),`;
                case 'decimal': return `      ${c.nombre}: double.tryParse(_${c.nombre}Ctrl.text.trim().replaceAll(',', '.')),`;
                case 'fecha': return `      ${c.nombre}: DateTime.tryParse(_${c.nombre}Ctrl.text.trim()),`;
                case 'bool': return `      ${c.nombre}: _${c.nombre},`;
                case 'fk': return `      ${c.nombre}: ${this.permiso(c.ref.name, 'ver')} ? _${c.nombre} : widget.registro?.${c.nombre},`;
                case 'muchos': return `      ${c.nombre}: ${this.permiso(c.ref.name, 'ver')} ? _${c.nombre}.toList() : widget.registro?.${c.nombre},`;
                default: return '';
            }
        }).join('\n');

        const widgets = visibles.map(c => this.widgetDeCampo(c)).join('\n            const SizedBox(height: 16),\n');

        return `${referencias.length ? "import 'dart:async';\n" : ''}import 'package:flutter/material.dart';

${imports}

class ${clase}FormScreen extends StatefulWidget {
  final ${clase}? registro;

  const ${clase}FormScreen({super.key, this.registro});

  @override
  State<${clase}FormScreen> createState() => _${clase}FormScreenState();
}

class _${clase}FormScreenState extends State<${clase}FormScreen> {
  final _formKey = GlobalKey<FormState>();
  final ${claseServicio(entity.name)} _service = ${claseServicio(entity.name)}();
  bool _guardando = false;
  bool get _puedeModificar => ${this.politica?.explicito === true ? `widget.registro == null
      ? ${this.permiso(entity.name, 'crear')}
      : ${this.permiso(entity.name, 'editar')}` : 'AuthService.puedeGestionar'};
${estado ? `\n${estado}\n` : ''}
  @override
  void initState() {
    super.initState();
    final registro = widget.registro;
    if (registro != null) {
${cargas}
    }${referencias.length ? '\n    _cargarOpciones();' : ''}
  }

  @override
  void dispose() {
${conControlador.map(c => `    _${c.nombre}Ctrl.dispose();`).join('\n')}
    super.dispose();
  }

  void _mostrar(String mensaje) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(mensaje)));
  }
${cargarOpciones}${ayudaFechas}${ayudaHoras}
  Future<void> _guardar() async {
    // Segunda barrera: aunque el botón no se dibuje para un rol de solo consulta,
    // nadie llega a enviar una petición que el backend va a rechazar.
    if (!_puedeModificar) {
      _mostrar('Tu rol no permite esta operación en ${titulo}.');
      return;
    }
${referencias.length ? '    if (_cargandoOpciones || _errorOpciones != null) return;' : ''}
    if (!_formKey.currentState!.validate()) return;
    setState(() => _guardando = true);
    final datos = ${clase}(
      ${pk.nombre}: widget.registro?.${pk.nombre},
${asignaciones}
    );
    try {
      final id = widget.registro?.${pk.nombre};
      if (id != null) {
        await _service.update(id, datos);
      } else {
        await _service.create(datos);
      }
      if (!mounted) return;
      _mostrar(id != null ? 'Registro actualizado' : 'Registro creado');
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      _mostrar('$e');
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final editando = widget.registro != null;
    // Un rol de solo consulta ve el registro entero pero no puede cambiarlo: el backend
    // ya rechaza la escritura, así que el formulario tampoco la ofrece.
    final soloLectura = !_puedeModificar;
    if (editando && !${this.permiso(entity.name, 'ver')}) {
      return Scaffold(appBar: AppBar(title: const Text('${titulo}')),
        body: const Center(child: Text('Tu rol no puede consultar este módulo.')));
    }
    return Scaffold(
      appBar: AppBar(title: Text(soloLectura
          ? 'Detalle de ${titulo}'
          : editando ? 'Editar ${titulo}' : 'Nuevo ${titulo}')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (soloLectura) const Padding(
              padding: EdgeInsets.only(bottom: 16),
              child: Text('Tu rol puede consultar este registro, pero no modificarlo.'),
            ),
${referencias.length ? `            if (_cargandoOpciones) const LinearProgressIndicator(),
            if (_errorOpciones != null) ...[
              Text(_errorOpciones!),
              TextButton(onPressed: _cargarOpciones, child: const Text('Reintentar opciones')),
            ],` : ''}
            AbsorbPointer(
              absorbing: soloLectura,
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
${widgets}
              ]),
            ),
            if (!soloLectura) ...[
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: _guardando${referencias.length ? ' || _cargandoOpciones || _errorOpciones != null' : ''} ? null : _guardar,
                icon: _guardando
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.save),
                label: Text(editando ? 'Actualizar' : 'Guardar'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
${referencias.length ? this.selectorRelacion() : ''}
`;
    }

    /** Selector remoto reutilizable para FK y muchos a muchos; conserva elecciones entre páginas. */
    selectorRelacion() {
        return `
class _SelectorRelacion<T, Id> extends StatefulWidget {
  final String titulo;
  final bool multiple;
  final Future<base.Pagina<T>> Function(int pagina, String buscar) cargar;
  final Id? Function(T opcion) idDe;
  final String Function(T opcion) etiqueta;
  final List<T> seleccionados;

  const _SelectorRelacion({required this.titulo, required this.multiple, required this.cargar,
    required this.idDe, required this.etiqueta, required this.seleccionados});

  @override
  State<_SelectorRelacion<T, Id>> createState() => _SelectorRelacionState<T, Id>();
}

class _SelectorRelacionState<T, Id> extends State<_SelectorRelacion<T, Id>> {
  final _scroll = ScrollController();
  final List<T> _opciones = [];
  final Map<Id, T> _seleccionados = {};
  Timer? _espera;
  String _buscar = '';
  String? _error;
  int _pagina = 0;
  int _solicitud = 0;
  bool _hayMas = true;
  bool _cargando = false;

  @override
  void initState() {
    super.initState();
    for (final opcion in widget.seleccionados) {
      final id = widget.idDe(opcion);
      if (id != null) _seleccionados[id] = opcion;
    }
    _scroll.addListener(_alDesplazar);
    _cargar();
  }

  @override
  void dispose() {
    _espera?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  void _alDesplazar() {
    if (_scroll.hasClients && _scroll.position.extentAfter < 200 && _error == null) _cargar();
  }

  void _filtrar(String texto) {
    _espera?.cancel();
    _solicitud++;
    setState(() {
      _buscar = texto.trim();
      _opciones.clear();
      _pagina = 0;
      _hayMas = true;
      _cargando = true;
      _error = null;
    });
    _espera = Timer(const Duration(milliseconds: 400), () {
      _cargando = false;
      _cargar();
    });
  }

  Future<void> _cargar() async {
    if (!mounted || _cargando || !_hayMas) return;
    final solicitud = ++_solicitud;
    setState(() { _cargando = true; _error = null; });
    try {
      final resultado = await widget.cargar(_pagina, _buscar);
      if (!mounted || solicitud != _solicitud) return;
      setState(() {
        _opciones.addAll(resultado.items);
        _pagina = resultado.pagina + 1;
        _hayMas = resultado.hayMas;
      });
    } catch (e) {
      if (mounted && solicitud == _solicitud) setState(() => _error = '$e');
    } finally {
      if (mounted && solicitud == _solicitud) {
        setState(() => _cargando = false);
        WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) _alDesplazar(); });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.titulo),
      content: SizedBox(width: 520, height: 420, child: Column(children: [
        TextField(onChanged: _filtrar, decoration: const InputDecoration(labelText: 'Buscar', prefixIcon: Icon(Icons.search))),
        if (widget.multiple) ...[
          Text('\${_seleccionados.length} seleccionados'),
          if (_seleccionados.isNotEmpty) SizedBox(height: 42, child: ListView(
            scrollDirection: Axis.horizontal,
            children: _seleccionados.entries.map((e) => Padding(padding: const EdgeInsets.only(right: 6), child: InputChip(
              label: Text(widget.etiqueta(e.value)), onDeleted: () => setState(() => _seleccionados.remove(e.key)),
            ))).toList(),
          )),
        ],
        Expanded(child: _opciones.isEmpty
          ? Center(child: _cargando ? const CircularProgressIndicator() : Column(mainAxisSize: MainAxisSize.min, children: [
              Text(_error ?? (_buscar.isEmpty ? 'Sin opciones disponibles' : 'No hay resultados para «$_buscar»')),
              if (_error != null) TextButton(onPressed: _cargar, child: const Text('Reintentar')),
            ]))
          : ListView.builder(controller: _scroll,
              itemCount: _opciones.length + (_hayMas || _error != null ? 1 : 0),
              itemBuilder: (context, index) {
                if (index == _opciones.length) {
                  return Padding(padding: const EdgeInsets.all(12), child: Center(
                    child: _error != null ? TextButton(onPressed: _cargar, child: Text('Reintentar: $_error')) : const CircularProgressIndicator(),
                  ));
                }
                final opcion = _opciones[index];
                final id = widget.idDe(opcion);
                if (widget.multiple) {
                  return CheckboxListTile(
                    title: Text(widget.etiqueta(opcion)), value: _seleccionados.containsKey(id),
                    onChanged: id == null ? null : (marcado) => setState(() {
                      if (marcado == true) { _seleccionados[id] = opcion; } else { _seleccionados.remove(id); }
                    }),
                  );
                }
                return ListTile(title: Text(widget.etiqueta(opcion)), selected: _seleccionados.containsKey(id),
                  onTap: id == null ? null : () => Navigator.pop(context, <T>[opcion]));
              },
            )),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
        if (widget.multiple) FilledButton(onPressed: () => Navigator.pop(context, _seleccionados.values.toList()), child: const Text('Aplicar selección')),
      ],
    );
  }
}
`;
    }

    widgetDeCampo(c) {
        const decoracion = (extra = '') =>
            `const InputDecoration(labelText: '${c.etiqueta}', border: OutlineInputBorder()${extra})`;
        const decoracionTemporal = (icono, seleccionar) => c.obligatorio
            ? decoracion(`, suffixIcon: Icon(Icons.${icono})`)
            : `InputDecoration(labelText: '${c.etiqueta}', border: const OutlineInputBorder(),
                suffixIcon: Row(mainAxisSize: MainAxisSize.min, children: [
                  IconButton(icon: const Icon(Icons.clear), tooltip: 'Limpiar',
                    onPressed: () => setState(_${c.nombre}Ctrl.clear)),
                  IconButton(icon: const Icon(Icons.${icono}), tooltip: 'Seleccionar', onPressed: ${seleccionar}),
                ]),
              )`;
        switch (c.control) {
            case 'texto':
                return `            TextFormField(
              controller: _${c.nombre}Ctrl,
              decoration: ${decoracion()},
              ${c.largo !== null ? `maxLength: ${c.largo},` : ''}
              validator: (valor) {
                final texto = valor?.trim() ?? '';
                if (texto.isEmpty) return ${c.obligatorio ? "'Campo obligatorio'" : 'null'};
                ${c.minimo > 1 ? `if (texto.length < ${c.minimo}) return 'Mínimo ${c.minimo} caracteres';` : ''}
                ${c.largo != null ? `if (texto.length > ${c.largo}) return 'Máximo ${c.largo} caracteres';` : ''}
                return null;
              },
            ),`;
            case 'entero':
            case 'decimal': {
                const decimal = c.control === 'decimal';
                const parseo = decimal ? `double.tryParse(texto.replaceAll(',', '.'))` : 'int.tryParse(texto)';
                return `            TextFormField(
              controller: _${c.nombre}Ctrl,
              decoration: ${decoracion()},
              keyboardType: const TextInputType.numberWithOptions(decimal: ${decimal}, signed: ${c.minimo == null || c.minimo < 0}),
              validator: (valor) {
                final texto = valor?.trim() ?? '';
                if (texto.isEmpty) return ${c.obligatorio ? "'Campo obligatorio'" : 'null'};
                final numero = ${parseo};
                if (numero == null) return '${decimal ? 'Debe ser un número' : 'Debe ser un número entero'}';
                ${c.minimo != null ? `if (numero < ${c.minimo}) return 'Mínimo ${c.minimo}';` : ''}
                ${c.maximo != null ? `if (numero > ${c.maximo}) return 'Máximo ${c.maximo}';` : ''}
                return null;
              },
            ),`;
            }
            case 'fecha':
                return `            TextFormField(
              controller: _${c.nombre}Ctrl,
              readOnly: true,
              decoration: ${decoracionTemporal('calendar_today', `() => _elegirFecha(_${c.nombre}Ctrl, soloFecha: ${c.soloFecha})`)},
              onTap: () => _elegirFecha(_${c.nombre}Ctrl, soloFecha: ${c.soloFecha}),
              validator: (valor) => (valor == null || valor.isEmpty) ? ${c.obligatorio ? "'Campo obligatorio'" : 'null'} : null,
            ),`;
            case 'hora':
                return `            TextFormField(
              controller: _${c.nombre}Ctrl,
              readOnly: true,
              decoration: ${decoracionTemporal('access_time', `() => _elegirHora(_${c.nombre}Ctrl)`)},
              onTap: () => _elegirHora(_${c.nombre}Ctrl),
              validator: (valor) => (valor == null || valor.isEmpty) ? ${c.obligatorio ? "'Campo obligatorio'" : 'null'} : null,
            ),`;
            case 'bool':
                return `            SwitchListTile(
              title: const Text('${c.etiqueta}'),
              value: _${c.nombre},
              onChanged: (valor) => setState(() => _${c.nombre} = valor),
            ),`;
            case 'fk': {
                const ref = nombreClase(c.ref.name);
                const pkRef = this.campoPk(c.ref);
                return `            if (!${this.permiso(c.ref.name, 'ver')})
              FormField<${pkRef.tipo}>(
                initialValue: _${c.nombre},
                validator: ${c.obligatorio ? "(valor) => valor == null ? 'Este campo necesita una selección autorizada' : null" : 'null'},
                builder: (campo) => InputDecorator(
                  decoration: InputDecoration(labelText: '${c.etiqueta}', border: const OutlineInputBorder(), errorText: campo.errorText),
                  child: Text(_${c.nombre} == null ? 'Tu rol no puede consultar estas opciones.' : 'Referencia #${'$_' + c.nombre} (sin acceso a sus datos)'),
                ),
              )
            else if (_hayMas${ref} || (_${c.nombre} != null && !_opciones${ref}.any((o) => o.${pkRef.nombre} == _${c.nombre})))
              FormField<${pkRef.tipo}>(
                key: ValueKey('${c.nombre}-${'$_' + c.nombre}'),
                initialValue: _${c.nombre},
                validator: ${c.obligatorio ? "(valor) => valor == null ? 'Selecciona una opción' : null" : 'null'},
                builder: (campo) => InputDecorator(
                  decoration: InputDecoration(labelText: '${c.etiqueta}', border: const OutlineInputBorder(), errorText: campo.errorText),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    if (_${c.nombre} != null && !_opciones${ref}.any((o) => o.${pkRef.nombre} == _${c.nombre}))
                      Text('Referencia #${'$_' + c.nombre} (fuera de tu acceso)'),
                    ..._opciones${ref}.where((o) => o.${pkRef.nombre} == _${c.nombre}).map((o) => Text(${this.etiquetaOpcion('o', c.ref)})),
                    Wrap(children: [
                      TextButton.icon(icon: const Icon(Icons.search), label: const Text('Buscar y seleccionar'),
                        onPressed: () async { await _elegir${c.nombre}(); if (campo.mounted) campo.didChange(_${c.nombre}); }),
                      ${c.obligatorio ? '' : `TextButton(onPressed: () { setState(() => _${c.nombre} = null); campo.didChange(null); }, child: const Text('Quitar selección')),`}
                    ]),
                  ]),
                ),
              )
            else DropdownButtonFormField<${pkRef.tipo}>(
              // La clave cambia al llegar las opciones para mostrar el valor ya elegido
              key: ValueKey('${c.nombre}-\${_opciones${ref}.length}-${'$_' + c.nombre}'),
              initialValue: _opciones${ref}.any((o) => o.${pkRef.nombre} == _${c.nombre}) ? _${c.nombre} : null,
              decoration: ${c.obligatorio ? decoracion() : `InputDecoration(labelText: '${c.etiqueta}', border: const OutlineInputBorder(), suffixIcon: IconButton(icon: const Icon(Icons.clear), tooltip: 'Quitar selección', onPressed: () => setState(() => _${c.nombre} = null)))`},
              isExpanded: true,
              items: _opciones${ref}
                  .where((o) => o.${pkRef.nombre} != null)
                  .map((o) => DropdownMenuItem<${pkRef.tipo}>(
                        value: o.${pkRef.nombre},
                        child: Text(${this.etiquetaOpcion('o', c.ref)}, overflow: TextOverflow.ellipsis),
                      ))
                  .toList(),
              onChanged: (valor) => setState(() => _${c.nombre} = valor),
              validator: ${c.obligatorio ? "(valor) => valor == null ? 'Selecciona una opción' : null" : 'null'},
            ),`;
            }
            case 'muchos': {
                const ref = nombreClase(c.ref.name);
                const pkRef = this.campoPk(c.ref);
                return `            InputDecorator(
              decoration: ${decoracion()},
              child: !${this.permiso(c.ref.name, 'ver')}
                  ? Text(_${c.nombre}.isEmpty ? 'Tu rol no puede consultar estas opciones.' : 'Referencias: \${_${c.nombre}.join(', ')} (sin acceso a sus datos)')
                  : _hayMas${ref} || _${c.nombre}.any((id) => !_opciones${ref}.any((o) => o.${pkRef.nombre} == id))
                  ? Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Wrap(spacing: 8, children: _${c.nombre}.map((id) {
                        final visibles = _opciones${ref}.where((o) => o.${pkRef.nombre} == id);
                        return InputChip(label: Text(visibles.isEmpty ? 'Referencia #$id' : ${this.etiquetaOpcion('visibles.first', c.ref)}),
                          onDeleted: visibles.isEmpty ? null : () => setState(() => _${c.nombre}.remove(id)));
                      }).toList()),
                      TextButton.icon(onPressed: _elegir${c.nombre}, icon: const Icon(Icons.search), label: const Text('Buscar y seleccionar')),
                    ])
                  : _opciones${ref}.isEmpty
                  ? const Text('Sin opciones disponibles')
                  : Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: _opciones${ref}
                          .where((o) => o.${pkRef.nombre} != null)
                          .map((o) => FilterChip(
                                label: Text(${this.etiquetaOpcion('o', c.ref)}),
                                selected: _${c.nombre}.contains(o.${pkRef.nombre}),
                                onSelected: (marcado) => setState(() {
                                  if (marcado) {
                                    _${c.nombre}.add(o.${pkRef.nombre}!);
                                  } else {
                                    _${c.nombre}.remove(o.${pkRef.nombre});
                                  }
                                }),
                              ))
                          .toList(),
                    ),
            ),`;
            }
            default:
                return '';
        }
    }
}

export default FlutterScreenGenerator;
