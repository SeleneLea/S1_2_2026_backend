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
        const ruta = this.toKebabCase(entity.name);
        const referencias = referenciasConOpciones(entity, this.entities, this.relationships, this.entidadesConApi);

        const imports = [
            `import '../models/${archivoDart(entity.name)}.dart';`,
            ...referencias
                .filter(r => r.name !== entity.name)
                .map(r => `import '../models/${archivoDart(r.name)}.dart';`),
            `import 'base_service.dart';`
        ].join('\n');

        const opciones = referencias.map(r => {
            const ref = nombreClase(r.name);
            return `
  /// Opciones para elegir ${ref} en el formulario
  Future<List<${ref}>> get${ref}Options() async {
    return aLista(await getData('/${this.toKebabCase(r.name)}'), ${ref}.fromJson);
  }
`;
        }).join('');

        return `${imports}

/// Acceso a /api/${ruta} del backend Spring Boot.
class ${clase}Service extends BaseService {
  static const String ruta = '/${ruta}';

  Future<List<${clase}>> getAll() async {
    return aLista(await getData(ruta), ${clase}.fromJson);
  }

  Future<${clase}> getById(${tipoId} id) async {
    return ${clase}.fromJson(await getData('$ruta/$id') as Map<String, dynamic>);
  }

  Future<${clase}> create(${clase} registro) async {
    return ${clase}.fromJson(await postData(ruta, registro.toJson()) as Map<String, dynamic>);
  }

  Future<${clase}> update(${tipoId} id, ${clase} registro) async {
    return ${clase}.fromJson(await putData('$ruta/$id', registro.toJson()) as Map<String, dynamic>);
  }

  Future<void> delete(${tipoId} id) => deleteData('$ruta/$id');
${opciones}}
`;
    }

    generateBaseService() {
        return `import 'dart:convert';

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

/// Peticiones HTTP comunes: devuelven el campo "data" de la respuesta del backend.
class BaseService {
  /// Cada llamada viaja con el token de la sesión: el backend comprueba el rol.
  Map<String, String> get _cabeceras => AuthService.cabeceras;

  String get baseUrl => ApiConfig.baseUrl;

  Future<dynamic> getData(String ruta) =>
      _enviar(() => http.get(Uri.parse('$baseUrl$ruta'), headers: _cabeceras));

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

  Future<dynamic> _enviar(Future<http.Response> Function() peticion) async {
    http.Response respuesta;
    try {
      respuesta = await peticion();
    } catch (_) {
      throw ApiException(
        'No se pudo conectar con el backend en $baseUrl. '
        'Verifica que Spring Boot esté corriendo y la URL de lib/config/api_config.dart.',
      );
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
      return json is Map<String, dynamic> && json.containsKey('data') ? json['data'] : json;
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
