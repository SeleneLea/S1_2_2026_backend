import { claseServicio } from './FlutterNombres.js';
import { rutaEntidad } from './NombresReservados.js';
import { archivoDart, nombreClase, pkDe, referenciasConOpciones, tipoDart } from './FlutterNombres.js';

/**
 * Servicios HTTP de Flutter para la API REST del backend Spring Boot.
 *
 * El backend responde { success, data, message } y, en errores de validación,
 * { message, errors: { campo: mensaje } }. BaseService devuelve "data" y convierte
 * cualquier error en ApiException con el mensaje del servidor. Antes el cuerpo se
 * leía sin UTF-8 (tildes rotas) y los errores 400/404/409 perdían el detalle.
 */
class FlutterServiceGenerator {
    constructor(entities = [], relationships = [], entidadesConApi = entities) {
        this.entities = entities;
        this.relationships = relationships;
        this.entidadesConApi = entidadesConApi;
    }

    generate(entity) {
        const clase = nombreClase(entity.name);
        const pk = pkDe(entity, this.entities, this.relationships);
        const tipoId = pk ? tipoDart(pk.type) : 'int';
        const ruta = rutaEntidad(entity.name);
        const referencias = referenciasConOpciones(entity, this.entities, this.relationships, this.entidadesConApi);

        const imports = [
            `import '../models/${archivoDart(entity.name)}.dart';`,
            ...referencias
                .filter(r => r.name !== entity.name)
                .map(r => `import '../models/${archivoDart(r.name)}.dart';`),
            `import 'base_service.dart' as base;`
        ].join('\n');

        const opciones = referencias.map(r => {
            const ref = nombreClase(r.name);
            const pkRef = pkDe(r, this.entities, this.relationships);
            return `
  Future<base.Pagina<${ref}>> get${ref}Pagina({int pagina = 0, int tamano = 20, String? buscar}) async {
    return base.Pagina.desde(await getRespuesta('/${rutaEntidad(r.name)}', consultaPagina(pagina, tamano, buscar)), ${ref}.fromJson);
  }

  /// La primera página; nunca descarga la tabla completa.
  Future<List<${ref}>> get${ref}Options({String? buscar, int tamano = 20}) async {
    return (await get${ref}Pagina(tamano: tamano, buscar: buscar)).items;
  }

  Future<${ref}> get${ref}OpcionPorId(${pkRef ? tipoDart(pkRef.type) : 'int'} id) async {
    return ${ref}.fromJson(await getData('/${rutaEntidad(r.name)}/\${Uri.encodeComponent(id.toString())}') as Map<String, dynamic>);
  }
`;
        }).join('');

        return `${imports}

/// Acceso a /api/${ruta} del backend Spring Boot.
class ${claseServicio(entity.name)} extends base.BaseService {
  static const String ruta = '/${ruta}';

  Future<List<${clase}>> getAll() async {
    return (await getPagina()).items;
  }

  Future<base.Pagina<${clase}>> getPagina({int pagina = 0, int tamano = 20, String? buscar, String? orden, Map<String, String> filtros = const {}}) async {
    final consulta = {...filtros, ...consultaPagina(pagina, tamano, buscar)};
    if (orden != null && orden.trim().isNotEmpty) consulta['orden'] = orden.trim();
    return base.Pagina.desde(await getRespuesta(ruta, consulta), ${clase}.fromJson);
  }

  Future<${clase}> getById(${tipoId} id) async {
    return ${clase}.fromJson(await getData('$ruta/\${Uri.encodeComponent(id.toString())}') as Map<String, dynamic>);
  }

  Future<${clase}> create(${clase} registro) async {
    return ${clase}.fromJson(await postData(ruta, registro.toJson()) as Map<String, dynamic>);
  }

  Future<${clase}> update(${tipoId} id, ${clase} registro) async {
    return ${clase}.fromJson(await putData('$ruta/\${Uri.encodeComponent(id.toString())}', registro.toJson()) as Map<String, dynamic>);
  }

  Future<void> delete(${tipoId} id) => deleteData('$ruta/\${Uri.encodeComponent(id.toString())}');
${opciones}}
`;
    }

    generateBaseService() {
        return `import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/api_config.dart';
import 'auth_service.dart';

/// Error devuelto por el backend, con el mensaje que envía Spring Boot.
class ApiException implements Exception {
  final int? status;
  final String mensaje;
  final Map<String, dynamic>? errores;

  ApiException(this.mensaje, {this.status, this.errores});

  @override
  String toString() {
    final detalle = errores;
    if (detalle == null || detalle.isEmpty) return mensaje;
    return '$mensaje\\n\${detalle.entries.map((e) => '\${e.key}: \${e.value}').join('\\n')}';
  }
}

/// Sobre paginado del backend; total incluye todas las coincidencias.
class Pagina<T> {
  final List<T> items;
  final int total;
  final int pagina;
  final bool hayMas;

  const Pagina({required this.items, required this.total, required this.pagina, required this.hayMas});

  factory Pagina.desde(Map<String, dynamic> respuesta, T Function(Map<String, dynamic>) desdeJson) {
    final items = ((respuesta['data'] as List?) ?? const [])
        .map((e) => desdeJson(e as Map<String, dynamic>)).toList();
    return Pagina(items: items, total: (respuesta['total'] as num?)?.toInt() ?? items.length,
      pagina: (respuesta['pagina'] as num?)?.toInt() ?? 0, hayMas: respuesta['hayMas'] == true);
  }
}

/// Peticiones HTTP comunes y consultas de listas limitadas.
class BaseService {
  /// Cada llamada viaja con el token de la sesión: el backend comprueba el rol.
  Map<String, String> get _cabeceras => AuthService.cabeceras;

  String get baseUrl => ApiConfig.baseUrl;

  Future<dynamic> getData(String ruta) =>
      _enviar(() => http.get(Uri.parse('$baseUrl$ruta'), headers: _cabeceras));

  Map<String, String> consultaPagina(int pagina, int tamano, String? buscar) => {
    'pagina': '$pagina', 'tamano': '$tamano',
    if (buscar != null && buscar.trim().isNotEmpty) 'buscar': buscar.trim(),
  };

  Future<Map<String, dynamic>> getRespuesta(String ruta, Map<String, String> consulta) async {
    final uri = Uri.parse('$baseUrl$ruta').replace(queryParameters: consulta);
    return await _enviar(() => http.get(uri, headers: _cabeceras), completo: true) as Map<String, dynamic>;
  }

  Future<dynamic> postData(String ruta, Map<String, dynamic> cuerpo) => _enviar(
      () => http.post(Uri.parse('$baseUrl$ruta'), headers: _cabeceras, body: jsonEncode(cuerpo)));

  Future<dynamic> putData(String ruta, Map<String, dynamic> cuerpo) => _enviar(
      () => http.put(Uri.parse('$baseUrl$ruta'), headers: _cabeceras, body: jsonEncode(cuerpo)));

  Future<void> deleteData(String ruta) async {
    await _enviar(() => http.delete(Uri.parse('$baseUrl$ruta'), headers: _cabeceras));
  }

  /// Convierte una lista JSON en objetos del modelo.
  List<T> aLista<T>(dynamic datos, T Function(Map<String, dynamic>) desdeJson) {
    return ((datos as List?) ?? const [])
        .map((e) => desdeJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<dynamic> _enviar(Future<http.Response> Function() peticion, {bool completo = false}) async {
    http.Response respuesta;
    try {
      respuesta = await peticion().timeout(ApiConfig.tiempoMaximo);
    } on TimeoutException {
      throw ApiException('El servidor tardó demasiado. Revisa la conexión e inténtalo de nuevo.');
    } catch (_) {
      throw ApiException(
        'No se pudo conectar con el backend en $baseUrl. '
        'Verifica que Spring Boot esté corriendo y la URL de lib/config/api_config.dart.',
      );
    }

    if (respuesta.statusCode == 401) {
      await AuthService.terminarSesion();
      throw ApiException('Tu sesión terminó. Vuelve a iniciar sesión.', status: 401);
    }

    // Spring responde JSON en UTF-8: decodificar los bytes evita tildes rotas
    final texto = utf8.decode(respuesta.bodyBytes);
    dynamic json;
    try {
      json = texto.isEmpty ? null : jsonDecode(texto);
    } catch (_) {
      json = null;
    }

    if (respuesta.statusCode >= 200 && respuesta.statusCode < 300) {
      return !completo && json is Map<String, dynamic> && json.containsKey('data') ? json['data'] : json;
    }

    final cuerpo = json is Map<String, dynamic> ? json : const <String, dynamic>{};
    final errores = cuerpo['errors'];
    throw ApiException(
      (cuerpo['message'] ?? cuerpo['error'] ?? 'Error HTTP \${respuesta.statusCode}').toString(),
      status: respuesta.statusCode,
      errores: errores is Map<String, dynamic> ? errores : null,
    );
  }
}
`;
    }

    /** Misma ruta que el controlador de Spring Boot: minúsculas, con guiones y sin tildes. */
    toKebabCase(str) {
        return String(str)
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
}

export default FlutterServiceGenerator;
