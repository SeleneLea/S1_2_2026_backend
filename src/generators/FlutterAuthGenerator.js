/**
 * Inicio de sesión en la app móvil generada.
 *
 * La app abre en la pantalla de acceso: quien entra elige su rol al crear la cuenta (los roles
 * salen de las clases de personas del diagrama). Según el rol, la app muestra o esconde los
 * botones de crear, editar y borrar; el backend además lo vuelve a comprobar.
 */
import { textoDart } from './FlutterNombres.js';

export const authServicioDart = (nombreApp) => `import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../config/api_config.dart';

/// Sesión del usuario: token, rol y si puede modificar datos.
///
/// El token queda guardado en el teléfono, así que al volver a abrir la app la sesión sigue
/// iniciada hasta que se cierre o venza.
class AuthService {
  static const String _claveToken = 'sesion.token';
  static const String _claveRol = 'sesion.rol';
  static const String _claveNombre = 'sesion.nombre';
  static const String _claveCorreo = 'sesion.correo';
  static const String _claveGestiona = 'sesion.gestiona';
  static const String _claveVinculacion = 'sesion.vinculacionPendiente';

  static String? token;
  static String? rol;
  static String? nombre;
  static String? correo;
  static bool puedeGestionar = false;
  static bool vinculacionPendiente = false;

  static DateTime? get vencimiento {
    try {
      final valor = token;
      if (valor == null || valor.split('.').length != 2) return null;
      final datos = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(valor.split('.').first))));
      final vence = datos is Map ? datos['vence'] : null;
      return vence is num ? DateTime.fromMillisecondsSinceEpoch(vence.toInt()) : null;
    } catch (_) { return null; }
  }

  static bool get haySesion => vencimiento?.isAfter(DateTime.now()) ?? false;
  static Future<void> Function()? alTerminarSesion;
  static bool _cerrando = false;

  static Future<void> terminarSesion() async {
    if (_cerrando || token == null) return;
    _cerrando = true;
    try {
      await cerrarSesion();
      await alTerminarSesion?.call();
    } finally { _cerrando = false; }
  }

  static Map<String, String> get cabeceras => {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json',
        if (haySesion) 'Authorization': 'Bearer \$token',
      };

  /// Recupera la sesión guardada al abrir la app.
  static Future<void> recuperar() async {
    final datos = await SharedPreferences.getInstance();
    token = datos.getString(_claveToken);
    rol = datos.getString(_claveRol);
    nombre = datos.getString(_claveNombre);
    correo = datos.getString(_claveCorreo);
    puedeGestionar = datos.getBool(_claveGestiona) ?? false;
    vinculacionPendiente = datos.getBool(_claveVinculacion) ?? false;
    if (!haySesion) {
      await cerrarSesion();
      return;
    }
    await actualizarSesion();
  }

  /// Actualiza el rol de la cuenta si hay conexión; conserva una sesión vigente sin red.
  static Future<void> actualizarSesion() async {
    final tokenActual = token;
    if (!haySesion || tokenActual == null) return;
    try {
      final respuesta = await http.get(Uri.parse('\${ApiConfig.baseUrl}/auth/yo'), headers: cabeceras)
          .timeout(const Duration(seconds: 3));
      // Una respuesta tardía nunca recupera una sesión que ya se cerró o se reemplazó.
      if (token != tokenActual) return;
      if (respuesta.statusCode == 401) {
        await terminarSesion();
        return;
      }
      if (respuesta.statusCode != 200) return;
      final cuerpo = jsonDecode(utf8.decode(respuesta.bodyBytes));
      final datos = cuerpo is Map ? cuerpo['data'] : null;
      if (datos is Map && datos['rol'] is String) {
        await _guardar({'token': tokenActual, ...Map<String, dynamic>.from(datos)});
      }
    } catch (_) {
      // El vencimiento se sigue comprobando localmente cuando el backend no responde.
    }
  }

  static Future<void> _guardar(Map<String, dynamic> datos) async {
    token = datos['token'] as String?;
    rol = datos['rol'] as String?;
    nombre = datos['nombre'] as String?;
    correo = datos['correo'] as String?;
    puedeGestionar = datos['puedeGestionar'] == true;
    vinculacionPendiente = datos.containsKey('referenciaId') && datos['referenciaId'] == null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_claveToken, token ?? '');
    await prefs.setString(_claveRol, rol ?? '');
    await prefs.setString(_claveNombre, nombre ?? '');
    await prefs.setString(_claveCorreo, correo ?? '');
    await prefs.setBool(_claveGestiona, puedeGestionar);
    await prefs.setBool(_claveVinculacion, vinculacionPendiente);
  }

  static Future<void> cerrarSesion() async {
    token = null;
    rol = null;
    nombre = null;
    correo = null;
    puedeGestionar = false;
    vinculacionPendiente = false;
    final prefs = await SharedPreferences.getInstance();
    for (final clave in [_claveToken, _claveRol, _claveNombre, _claveCorreo, _claveGestiona, _claveVinculacion]) {
      await prefs.remove(clave);
    }
  }

  /// Roles disponibles en ${textoDart(nombreApp)} (los define el backend).
  static Future<List<String>> roles() async {
    try {
      final r = await http.get(Uri.parse('\${ApiConfig.baseUrl}/auth/roles'), headers: cabeceras).timeout(ApiConfig.tiempoMaximo);
      final cuerpo = jsonDecode(utf8.decode(r.bodyBytes));
      final datos = cuerpo is Map ? cuerpo['data'] : null;
      final lista = datos is Map ? (datos['registroPublico'] ?? datos['roles']) : null;
      return lista is List ? lista.map((e) => e.toString()).toList() : const [];
    } catch (_) {
      return const [];
    }
  }

  static Future<String?> entrar(String correo, String clave) =>
      _pedir('/auth/login', {'correo': correo, 'clave': clave});

  static Future<String?> registrarse(String correo, String clave, String rol, String nombre) =>
      _pedir('/auth/registro', {'correo': correo, 'clave': clave, 'rol': rol, 'nombre': nombre});

  /// Devuelve null si salió bien, o el mensaje de error para mostrar.
  static Future<String?> _pedir(String ruta, Map<String, dynamic> cuerpo) async {
    try {
      final r = await http.post(
        Uri.parse('\${ApiConfig.baseUrl}\$ruta'),
        headers: cabeceras,
        body: jsonEncode(cuerpo),
      ).timeout(ApiConfig.tiempoMaximo);
      final datos = jsonDecode(utf8.decode(r.bodyBytes));
      if (r.statusCode >= 200 && r.statusCode < 300 && datos is Map && datos['data'] is Map) {
        await _guardar(Map<String, dynamic>.from(datos['data'] as Map));
        return null;
      }
      if (datos is Map && datos['message'] is String) return datos['message'] as String;
      return 'No se pudo completar la operación (\${r.statusCode}).';
    } on TimeoutException {
      return 'El servidor tardó más de \${ApiConfig.tiempoMaximo.inSeconds} segundos en responder. Inténtalo de nuevo.';
    } catch (e) {
      return 'No se pudo conectar con el servidor. Revisa que esté encendido y la dirección de la app.';
    }
  }
}
`;

export const loginPantallaDart = (nombreApp) => `import 'package:flutter/material.dart';

import '../services/auth_service.dart';
import 'home_screen.dart';

/// Acceso a ${textoDart(nombreApp)}: entrar con una cuenta o crear una nueva eligiendo el rol.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _correoCtrl = TextEditingController();
  final _claveCtrl = TextEditingController();
  final _nombreCtrl = TextEditingController();
  bool _creandoCuenta = false;
  bool _ocupado = false;
  List<String> _roles = [];
  String? _rol;

  @override
  void initState() {
    super.initState();
    _cargarRoles();
  }

  Future<void> _cargarRoles() async {
    final roles = await AuthService.roles();
    if (!mounted) return;
    setState(() {
      _roles = roles;
      _rol = roles.isNotEmpty ? roles.first : null;
    });
  }

  @override
  void dispose() {
    _correoCtrl.dispose();
    _claveCtrl.dispose();
    _nombreCtrl.dispose();
    super.dispose();
  }

  Future<void> _enviar() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _ocupado = true);
    final error = _creandoCuenta
        ? await AuthService.registrarse(
            _correoCtrl.text.trim(), _claveCtrl.text, _rol ?? '', _nombreCtrl.text.trim())
        : await AuthService.entrar(_correoCtrl.text.trim(), _claveCtrl.text);
    if (!mounted) return;
    setState(() => _ocupado = false);
    if (error != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error)));
      return;
    }
    Navigator.pushReplacement(context, MaterialPageRoute(builder: (context) => const HomeScreen()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.lock_outline, size: 56),
                  const SizedBox(height: 12),
                  Text('${textoDart(nombreApp)}',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 4),
                  Text(_creandoCuenta ? 'Crea tu cuenta' : 'Inicia sesión para continuar',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium),
                  const SizedBox(height: 24),
                  TextFormField(
                    controller: _correoCtrl,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'Correo', border: OutlineInputBorder()),
                    validator: (v) => (v == null || !v.contains('@')) ? 'Escribe tu correo' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _claveCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'Clave', border: OutlineInputBorder()),
                    validator: (v) => (v == null || v.length < 8) ? 'Al menos 8 caracteres' : null,
                  ),
                  if (_creandoCuenta) ...[
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _nombreCtrl,
                      decoration: const InputDecoration(labelText: 'Nombre', border: OutlineInputBorder()),
                      validator: (v) => (v == null || v.trim().isEmpty) ? 'Escribe tu nombre' : null,
                    ),
                    const SizedBox(height: 16),
                    DropdownButtonFormField<String>(
                      initialValue: _rol,
                      decoration: const InputDecoration(labelText: 'Rol', border: OutlineInputBorder()),
                      items: _roles
                          .map((r) => DropdownMenuItem(value: r, child: Text(r)))
                          .toList(),
                      onChanged: (v) => setState(() => _rol = v),
                      validator: (v) => (v == null || v.isEmpty) ? 'Elige tu rol' : null,
                    ),
                  ],
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _ocupado ? null : _enviar,
                    child: Text(_ocupado
                        ? 'Un momento…'
                        : (_creandoCuenta ? 'Crear cuenta' : 'Entrar')),
                  ),
                  if (_roles.isEmpty) const Text('Las cuentas las crea quien administra.'),
                  if (_roles.isNotEmpty) TextButton(
                    onPressed: _ocupado ? null : () => setState(() => _creandoCuenta = !_creandoCuenta),
                    child: Text(_creandoCuenta
                        ? 'Ya tengo cuenta: iniciar sesión'
                        : 'No tengo cuenta: crear una'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
`;
