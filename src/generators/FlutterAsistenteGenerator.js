/**
 * Asistente de la app móvil generada.
 *
 * Es híbrido, igual que el del diagramador web:
 *   1. Sin internet responde el asistente del propio teléfono, que conoce las clases del
 *      sistema y sus campos, y lleva al usuario a la pantalla que pide.
 *   2. Con internet, si el pedido no encaja en esas respuestas, pregunta al backend
 *      (endpoint /api/asistente), que habla con el servicio de IA configurado.
 */
import { archivoDart, atributoDescriptivo, campoJava, claveDeAtributo, etiquetaCampo, nombreClase, textoDart } from './FlutterNombres.js';

const tipoLegible = (attr) => ({
    String: 'texto', Integer: 'número entero', Long: 'número entero', Double: 'número decimal',
    Float: 'número decimal', BigDecimal: 'número decimal', Boolean: 'sí o no',
    LocalDate: 'fecha', LocalDateTime: 'fecha y hora', LocalTime: 'hora', UUID: 'texto'
}[attr.type] || 'texto');

/** Catálogo de clases y campos que el asistente del teléfono usa para responder. */
const catalogoDart = (entidades, atributosDe) => entidades.map((e) => {
    const campos = atributosDe(e)
        .filter((a) => !a.isPrimaryKey)
        .map((a) => `      _Campo('${textoDart(etiquetaCampo(claveDeAtributo(a)))}', '${textoDart(tipoLegible(a))}', ${a.isForeignKey ? 'true' : 'false'})`);
    return `    _Clase(
      nombre: '${textoDart(etiquetaCampo(e.name))}',
      clave: '${textoDart(campoJava(e.name).toLowerCase())}',
      campos: [
${campos.join(',\n') || ''}
      ],
    )`;
}).join(',\n');

export const asistenteLocalDart = (nombreApp, entidades, atributosDe, proposito = '') => `// Asistente que funciona sin internet.
//
// Conoce las clases del sistema y sus campos, así que puede responder qué guarda la
// aplicación, qué datos pide cada formulario y a qué pantalla ir. Lo que no entiende se
// deriva al asistente del servidor (que sí usa un modelo de IA).

class RespuestaLocal {
  final String texto;
  final bool entendido;
  /// Clave de la clase mencionada, para abrir su pantalla desde el chat.
  final String? claseSugerida;

  const RespuestaLocal(this.texto, {this.entendido = true, this.claseSugerida});
}

class _Campo {
  final String nombre;
  final String tipo;
  final bool esReferencia;
  const _Campo(this.nombre, this.tipo, this.esReferencia);
}

class _Clase {
  final String nombre;
  final String clave;
  final List<_Campo> campos;
  const _Clase({required this.nombre, required this.clave, required this.campos});
}

class AsistenteLocal {
  static const String app = '${textoDart(nombreApp)}';

  /// De qué trata el sistema, escrito al exportar el proyecto desde el diagrama.
  static const String proposito = '${textoDart(proposito || '')}';

  static const List<_Clase> _clases = [
${catalogoDart(entidades, atributosDe)}
  ];

  static String get clasesDisponibles => _clases.map((c) => c.nombre).join(', ');

  /// Quita tildes y mayúsculas para comparar lo que escribe el usuario.
  static String _normalizar(String texto) {
    const con = 'áéíóúàèìòùäëïöüâêîôûñ';
    const sin = 'aeiouaeiouaeiouaeioun';
    final b = StringBuffer();
    for (final c in texto.toLowerCase().split('')) {
      final i = con.indexOf(c);
      b.write(i >= 0 ? sin[i] : c);
    }
    return b.toString();
  }

  static _Clase? _claseEn(String pregunta) {
    final p = _normalizar(pregunta);
    for (final c in _clases) {
      final nombre = _normalizar(c.nombre);
      if (p.contains(nombre) || p.contains('\${nombre}s')) return c;
    }
    return null;
  }

  static String _listaCampos(_Clase clase) => clase.campos.isEmpty
      ? 'no pide datos propios'
      : clase.campos.map((f) => '\${f.nombre} (\${f.tipo}\${f.esReferencia ? ', se elige de una lista' : ''})').join(', ');

  /// Responde lo que se pueda sin internet. Si no entiende, marca entendido = false.
  static RespuestaLocal responder(String pregunta) {
    final p = _normalizar(pregunta.trim());
    if (p.isEmpty) {
      return const RespuestaLocal('Escribe tu pregunta: por ejemplo, "qué guarda la aplicación".');
    }

    if (p.contains('hola') || p.contains('buenas') || p.contains('ayuda') || p.contains('que puedes hacer')) {
      return RespuestaLocal(
        'Soy el asistente de \$app. \${proposito.isEmpty ? '' : '\$proposito '}'
        'Puedo decirte qué datos pide cada formulario y llevarte a cada pantalla. '
        'Secciones: \$clasesDisponibles.',
      );
    }

    if (p.contains('que guarda') || p.contains('que hace') || p.contains('para que sirve') ||
        p.contains('de que trata') || p.contains('secciones') || p.contains('que datos maneja')) {
      return RespuestaLocal(
        proposito.isEmpty
            ? '\$app administra: \$clasesDisponibles.'
            : '\$proposito Secciones: \$clasesDisponibles.',
      );
    }

    final clase = _claseEn(pregunta);
    if (clase != null) {
      final quiereCrear = p.contains('crear') || p.contains('registrar') || p.contains('nuevo') ||
          p.contains('nueva') || p.contains('agregar') || p.contains('añadir');
      final quiereVer = p.contains('ver') || p.contains('listar') || p.contains('lista') ||
          p.contains('mostrar') || p.contains('consultar') || p.contains('buscar');
      final quiereCampos = p.contains('campo') || p.contains('dato') || p.contains('pide') ||
          p.contains('necesito') || p.contains('llenar') || p.contains('requiere');

      if (quiereCampos) {
        return RespuestaLocal(
          'Para registrar \${clase.nombre} se piden: \${_listaCampos(clase)}.',
          claseSugerida: clase.clave,
        );
      }
      if (quiereCrear) {
        return RespuestaLocal(
          'Abre \${clase.nombre} y pulsa el botón +. El formulario pide: \${_listaCampos(clase)}.',
          claseSugerida: clase.clave,
        );
      }
      if (quiereVer) {
        return RespuestaLocal('Te llevo a la lista de \${clase.nombre}.', claseSugerida: clase.clave);
      }
      return RespuestaLocal(
        '\${clase.nombre} guarda: \${_listaCampos(clase)}.',
        claseSugerida: clase.clave,
      );
    }

    return RespuestaLocal(
      'Sin internet solo respondo sobre lo que guarda la aplicación: \$clasesDisponibles.',
      entendido: false,
    );
  }
}
`;

export const asistenteServicioDart = () => `import 'base_service.dart';

/// Asistente del servidor: POST /api/asistente (usa el servicio de IA configurado en el backend).
class AsistenteService extends BaseService {
  /// ¿El servidor tiene configurado el asistente por internet?
  Future<bool> disponible() async {
    try {
      final datos = await getData('/asistente/estado');
      if (datos is Map && datos['configurado'] is bool) return datos['configurado'] as bool;
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Devuelve la respuesta del asistente del servidor.
  Future<String> preguntar(String pregunta) async {
    final datos = await postData('/asistente', {'pregunta': pregunta});
    if (datos is Map && datos['respuesta'] is String) return datos['respuesta'] as String;
    return datos?.toString() ?? '';
  }
}
`;

export const asistentePantallaDart = (nombreApp, entidades) => {
    const imports = entidades
        .map((e) => `import '${archivoDart(e.name)}_list_screen.dart';`)
        .join('\n');
    const rutas = entidades
        .map((e) => `    '${campoJava(e.name).toLowerCase()}': () => const ${nombreClase(e.name)}ListScreen(),`)
        .join('\n');
    return `import 'package:flutter/material.dart';

import '../asistente/asistente_local.dart';
import '../services/asistente_service.dart';
import '../services/base_service.dart';
${imports}

/// Asistente de ${textoDart(nombreApp)}.
///
/// Responde primero con el asistente del teléfono (funciona sin internet). Si el pedido
/// necesita más, consulta al asistente del servidor, que usa un modelo de IA.
class AsistenteScreen extends StatefulWidget {
  const AsistenteScreen({super.key});

  @override
  State<AsistenteScreen> createState() => _AsistenteScreenState();
}

class _Mensaje {
  final String texto;
  final bool mio;
  final String origen;
  final String? clase;
  const _Mensaje(this.texto, {this.mio = false, this.origen = '', this.clase});
}

class _AsistenteScreenState extends State<AsistenteScreen> {
  static final Map<String, Widget Function()> _pantallas = {
${rutas}
  };

  final _service = AsistenteService();
  final _controlador = TextEditingController();
  final List<_Mensaje> _mensajes = [];
  bool _enviando = false;

  @override
  void initState() {
    super.initState();
    _mensajes.add(_Mensaje(
      'Hola, soy el asistente de \${AsistenteLocal.app}. Puedo explicarte qué guarda el sistema '
      'y llevarte a cada sección. Pregúntame, por ejemplo: "¿qué datos pide un registro?".',
      origen: 'en este teléfono',
    ));
  }

  @override
  void dispose() {
    _controlador.dispose();
    super.dispose();
  }

  Future<void> _enviar() async {
    final pregunta = _controlador.text.trim();
    if (pregunta.isEmpty || _enviando) return;
    setState(() {
      _mensajes.add(_Mensaje(pregunta, mio: true));
      _controlador.clear();
      _enviando = true;
    });

    final local = AsistenteLocal.responder(pregunta);
    if (local.entendido) {
      setState(() {
        _mensajes.add(_Mensaje(local.texto, origen: 'en este teléfono', clase: local.claseSugerida));
        _enviando = false;
      });
      return;
    }

    // No alcanzó con el asistente del teléfono: se intenta con el del servidor
    try {
      final respuesta = await _service.preguntar(pregunta);
      setState(() => _mensajes.add(_Mensaje(respuesta, origen: 'asistente del servidor')));
    } on ApiException catch (e) {
      setState(() => _mensajes.add(_Mensaje('\${local.texto}\\n\\n(\${e.mensaje})', origen: 'en este teléfono')));
    } catch (_) {
      setState(() => _mensajes.add(_Mensaje(local.texto, origen: 'en este teléfono')));
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  void _abrir(String clase) {
    final constructor = _pantallas[clase];
    if (constructor == null) return;
    Navigator.push(context, MaterialPageRoute(builder: (context) => constructor()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Asistente')),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: _mensajes.length,
              itemBuilder: (context, i) {
                final m = _mensajes[i];
                return Align(
                  alignment: m.mio ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    margin: const EdgeInsets.symmetric(vertical: 4),
                    padding: const EdgeInsets.all(12),
                    constraints: const BoxConstraints(maxWidth: 320),
                    decoration: BoxDecoration(
                      color: m.mio
                          ? Theme.of(context).colorScheme.primaryContainer
                          : Theme.of(context).colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(m.texto),
                        if (!m.mio && m.origen.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(m.origen, style: Theme.of(context).textTheme.labelSmall),
                          ),
                        if (m.clase != null && _pantallas.containsKey(m.clase))
                          TextButton(
                            onPressed: () => _abrir(m.clase!),
                            child: const Text('Abrir esa sección'),
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          if (_enviando) const LinearProgressIndicator(),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controlador,
                      decoration: const InputDecoration(
                        hintText: 'Escribe tu pregunta',
                        border: OutlineInputBorder(),
                      ),
                      onSubmitted: (_) => _enviar(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: _enviando ? null : _enviar,
                    child: const Text('Enviar'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
`;
};
