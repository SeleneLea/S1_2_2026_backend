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
    constructor(entities = [], relationships = [], entidadesConApi = entities) {
        this.entities = entities;
        this.relationships = relationships;
        this.entidadesConApi = entidadesConApi;
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
        const etiqueta = etiquetaCampo(claveDeAtributo(attr));
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
        const imports = entidades.map(e => `import '${archivoDart(e.name)}_list_screen.dart';`).join('\n');
        const entradas = entidades.map(e =>
            `    _Entrada('${textoDart(etiquetaCampo(e.name))}', () => const ${nombreClase(e.name)}ListScreen()),`
        ).join('\n');
        return `import 'package:flutter/material.dart';

${imports}

/// Pantalla principal: una entrada por cada entidad con API en el backend.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  static final List<_Entrada> _entradas = [
${entradas}
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('${textoDart(nombreApp)}')),
      body: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _entradas.length,
        separatorBuilder: (context, index) => const SizedBox(height: 8),
        itemBuilder: (context, index) {
          final entrada = _entradas[index];
          return Card(
            child: ListTile(
              leading: const Icon(Icons.view_list),
              title: Text(entrada.titulo),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (context) => entrada.pantalla()),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _Entrada {
  final String titulo;
  final Widget Function() pantalla;

  const _Entrada(this.titulo, this.pantalla);
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
        const otros = atributos.filter(a => !a.isPrimaryKey && !a.isForeignKey && a !== descriptivo).slice(0, 2);

        // El atributo descriptivo siempre es String: se usa directo, sin interpolar
        const textoTitulo = descriptivo
            ? `registro.${this.campo(descriptivo)} ?? '-'`
            : `'${titulo} #\${registro.${pk.nombre}}'`;
        const partes = [
            `ID: \${registro.${pk.nombre}}`,
            ...otros.map(a => `${textoDart(etiquetaCampo(claveDeAtributo(a)))}: \${registro.${this.campo(a)} ?? '-'}`)
        ];
        const textoSubtitulo = `'${partes.join(' · ')}'`;

        return `import 'package:flutter/material.dart';

import '../models/${archivo}.dart';
import '../services/${archivo}_service.dart';
import '${archivo}_form_screen.dart';

class ${clase}ListScreen extends StatefulWidget {
  const ${clase}ListScreen({super.key});

  @override
  State<${clase}ListScreen> createState() => _${clase}ListScreenState();
}

class _${clase}ListScreenState extends State<${clase}ListScreen> {
  final ${clase}Service _service = ${clase}Service();
  late Future<List<${clase}>> _registros;

  @override
  void initState() {
    super.initState();
    _registros = _service.getAll();
  }

  void _recargar() {
    setState(() {
      _registros = _service.getAll();
    });
  }

  void _mostrar(String mensaje) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(mensaje)));
  }

  Future<void> _abrirFormulario([${clase}? registro]) async {
    final guardado = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (context) => ${clase}FormScreen(registro: registro)),
    );
    if (guardado == true) _recargar();
  }

  Future<void> _eliminar(${clase} registro) async {
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('${titulo}'),
        actions: [
          IconButton(onPressed: _recargar, icon: const Icon(Icons.refresh), tooltip: 'Recargar'),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _abrirFormulario(),
        tooltip: 'Nuevo',
        child: const Icon(Icons.add),
      ),
      body: FutureBuilder<List<${clase}>>(
        future: _registros,
        builder: (context, estado) {
          if (estado.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (estado.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline, size: 48, color: Colors.red),
                    const SizedBox(height: 12),
                    Text('\${estado.error}', textAlign: TextAlign.center),
                    const SizedBox(height: 12),
                    FilledButton(onPressed: _recargar, child: const Text('Reintentar')),
                  ],
                ),
              ),
            );
          }
          final registros = estado.data ?? const [];
          if (registros.isEmpty) {
            return const Center(child: Text('No hay registros'));
          }
          return ListView.separated(
            padding: const EdgeInsets.all(8),
            itemCount: registros.length,
            separatorBuilder: (context, index) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final registro = registros[index];
              return ListTile(
                title: Text(${textoTitulo}),
                subtitle: Text(${textoSubtitulo}),
                onTap: () => _abrirFormulario(registro),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  tooltip: 'Eliminar',
                  onPressed: () => _eliminar(registro),
                ),
              );
            },
          );
        },
      ),
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

        const campos = this.atributos(entity).filter(a => !a.isPrimaryKey).map(a => {
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
                obligatorio: a.isForeignKey ? a.isRequired === true : true
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
        const referencias = referenciasConOpciones(entity, this.entities, this.relationships, this.entidadesConApi);
        const usaFechas = campos.some(c => c.control === 'fecha');
        const usaHoras = campos.some(c => c.control === 'hora');
        const conControlador = campos.filter(c => ['texto', 'entero', 'decimal', 'fecha', 'hora'].includes(c.control));

        const imports = [
            `import '../models/${archivo}.dart';`,
            ...referencias.filter(r => r.name !== entity.name).map(r => `import '../models/${archivoDart(r.name)}.dart';`),
            `import '../services/${archivo}_service.dart';`
        ].join('\n');

        const estado = [
            ...conControlador.map(c => `  final _${c.nombre}Ctrl = TextEditingController();`),
            ...campos.filter(c => c.control === 'bool').map(c => `  bool _${c.nombre} = false;`),
            ...campos.filter(c => c.control === 'fk').map(c => `  ${this.campoPk(c.ref).tipo}? _${c.nombre};`),
            ...muchos.map(c => `  Set<${this.campoPk(c.ref).tipo}> _${c.nombre} = {};`),
            ...referencias.map(r => `  List<${nombreClase(r.name)}> _opciones${nombreClase(r.name)} = [];`)
        ].join('\n');

        const cargas = todos.map(c => {
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
    try {
${referencias.map(r => `      final opciones${nombreClase(r.name)} = await _service.get${nombreClase(r.name)}Options();`).join('\n')}
      if (!mounted) return;
      setState(() {
${referencias.map(r => `        _opciones${nombreClase(r.name)} = opciones${nombreClase(r.name)};`).join('\n')}
      });
    } catch (e) {
      if (!mounted) return;
      _mostrar('No se pudieron cargar las opciones: $e');
    }
  }
` : '';

        const ayudaFechas = usaFechas ? `
  Future<void> _elegirFecha(TextEditingController controlador, {required bool soloFecha}) async {
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
            switch (c.control) {
                case 'texto':
                case 'hora': return `      ${c.nombre}: _${c.nombre}Ctrl.text.trim(),`;
                case 'entero': return `      ${c.nombre}: int.tryParse(_${c.nombre}Ctrl.text.trim()),`;
                case 'decimal': return `      ${c.nombre}: double.tryParse(_${c.nombre}Ctrl.text.trim().replaceAll(',', '.')),`;
                case 'fecha': return `      ${c.nombre}: DateTime.tryParse(_${c.nombre}Ctrl.text.trim()),`;
                case 'bool':
                case 'fk': return `      ${c.nombre}: _${c.nombre},`;
                case 'muchos': return `      ${c.nombre}: _${c.nombre}.toList(),`;
                default: return '';
            }
        }).join('\n');

        const widgets = todos.map(c => this.widgetDeCampo(c)).join('\n            const SizedBox(height: 16),\n');

        return `import 'package:flutter/material.dart';

${imports}

class ${clase}FormScreen extends StatefulWidget {
  final ${clase}? registro;

  const ${clase}FormScreen({super.key, this.registro});

  @override
  State<${clase}FormScreen> createState() => _${clase}FormScreenState();
}

class _${clase}FormScreenState extends State<${clase}FormScreen> {
  final _formKey = GlobalKey<FormState>();
  final ${clase}Service _service = ${clase}Service();
  bool _guardando = false;
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
    return Scaffold(
      appBar: AppBar(title: Text(editando ? 'Editar ${titulo}' : 'Nuevo ${titulo}')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
${widgets}${widgets ? '\n            const SizedBox(height: 24),' : ''}
            FilledButton.icon(
              onPressed: _guardando ? null : _guardar,
              icon: _guardando
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.save),
              label: Text(editando ? 'Actualizar' : 'Guardar'),
            ),
          ],
        ),
      ),
    );
  }
}
`;
    }

    widgetDeCampo(c) {
        const decoracion = (extra = '') =>
            `const InputDecoration(labelText: '${c.etiqueta}', border: OutlineInputBorder()${extra})`;
        switch (c.control) {
            case 'texto':
                // Mismo largo máximo que @Size en el backend
                return c.largo ? `            TextFormField(
              controller: _${c.nombre}Ctrl,
              decoration: ${decoracion()},
              validator: (valor) {
                final texto = valor?.trim() ?? '';
                if (texto.isEmpty) return 'Campo obligatorio';
                if (texto.length > ${c.largo}) return 'Máximo ${c.largo} ${c.largo === 1 ? 'carácter' : 'caracteres'}';
                return null;
              },
            ),` : `            TextFormField(
              controller: _${c.nombre}Ctrl,
              decoration: ${decoracion()},
              validator: (valor) => (valor == null || valor.trim().isEmpty) ? 'Campo obligatorio' : null,
            ),`;
            case 'entero':
            case 'decimal': {
                const decimal = c.control === 'decimal';
                const parseo = decimal ? `double.tryParse(texto.replaceAll(',', '.'))` : 'int.tryParse(texto)';
                return `            TextFormField(
              controller: _${c.nombre}Ctrl,
              decoration: ${decoracion()},
              keyboardType: ${decimal ? 'const TextInputType.numberWithOptions(decimal: true)' : 'TextInputType.number'},
              validator: (valor) {
                final texto = valor?.trim() ?? '';
                if (texto.isEmpty) return ${c.obligatorio ? "'Campo obligatorio'" : 'null'};
                final numero = ${parseo};
                if (numero == null) return '${decimal ? 'Debe ser un número' : 'Debe ser un número entero'}';
                if (numero < 0) return 'No puede ser negativo';
                return null;
              },
            ),`;
            }
            case 'fecha':
                return `            TextFormField(
              controller: _${c.nombre}Ctrl,
              readOnly: true,
              decoration: ${decoracion(', suffixIcon: Icon(Icons.calendar_today)')},
              onTap: () => _elegirFecha(_${c.nombre}Ctrl, soloFecha: ${c.soloFecha}),
              validator: (valor) => (valor == null || valor.isEmpty) ? 'Campo obligatorio' : null,
            ),`;
            case 'hora':
                return `            TextFormField(
              controller: _${c.nombre}Ctrl,
              readOnly: true,
              decoration: ${decoracion(', suffixIcon: Icon(Icons.access_time)')},
              onTap: () => _elegirHora(_${c.nombre}Ctrl),
              validator: (valor) => (valor == null || valor.isEmpty) ? 'Campo obligatorio' : null,
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
                return `            DropdownButtonFormField<${pkRef.tipo}>(
              // La clave cambia al llegar las opciones para mostrar el valor ya elegido
              key: ValueKey('${c.nombre}-\${_opciones${ref}.length}'),
              initialValue: _opciones${ref}.any((o) => o.${pkRef.nombre} == _${c.nombre}) ? _${c.nombre} : null,
              decoration: ${decoracion()},
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
              child: _opciones${ref}.isEmpty
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
