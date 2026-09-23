import { archivoDart, etiquetaCampo, textoDart } from './FlutterNombres.js';
import { rutaEntidad } from './NombresReservados.js';

/**
 * Archivos de proyecto de la app Flutter: main, pubspec, configuración de la
 * API, lints, prueba básica y documentación.
 */
class FlutterMainGenerator {
    /**
     * @param {string} nombrePaquete  nombre del paquete Dart (p. ej. "tienda")
     * @param {string} titulo         nombre visible de la app (p. ej. "tienda")
     */
    constructor(nombrePaquete, titulo = nombrePaquete) {
        this.projectName = nombrePaquete;
        this.titulo = titulo;
    }

    generateMain() {
        return `import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'services/auth_service.dart';

final navegador = GlobalKey<NavigatorState>();
final mensajes = GlobalKey<ScaffoldMessengerState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Si ya se inició sesión antes, la app abre directo en el inicio
  await AuthService.recuperar();
  AuthService.alTerminarSesion = () async {
    navegador.currentState?.pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()), (ruta) => false);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      mensajes.currentState?.showSnackBar(const SnackBar(content: Text('Tu sesión terminó. Vuelve a iniciar sesión.')));
    });
  };
  runApp(const MiApp());
}

class MiApp extends StatelessWidget {
  const MiApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: navegador,
      scaffoldMessengerKey: mensajes,
      title: '${textoDart(this.titulo)}',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      // Calendarios, botones y mensajes del sistema en espanol
      locale: const Locale('es'),
      supportedLocales: const [Locale('es'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: AuthService.haySesion ? const HomeScreen() : const LoginScreen(),
    );
  }
}
`;
    }

    generatePubspec() {
        return `name: ${this.projectName}
description: App Flutter generada desde el diagrama de clases; consume el backend Spring Boot generado desde el mismo diagrama.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=3.0.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter
  flutter_localizations:
    sdk: flutter
  http: ^1.2.0
  shared_preferences: ^2.3.2
  cupertino_icons: ^1.0.8

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^5.0.0

flutter:
  uses-material-design: true
`;
    }

    generateAnalysisOptions() {
        return `include: package:flutter_lints/flutter.yaml
`;
    }

    // Pruebas locales: no llaman al backend ni abren la pantalla que consulta los roles.
    // El archivo evita además que flutter create agregue su prueba del contador de ejemplo.
    generateWidgetTest() {
        return `import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:${this.projectName}/services/auth_service.dart';

// La firma se valida en el servidor. Estas pruebas solo comprueban la fecha local.
String tokenConVencimiento(DateTime fecha) {
  final cuerpo = base64Url.encode(utf8.encode(jsonEncode({
    'correo': 'prueba@example.test',
    'rol': 'PRUEBA',
    'vence': fecha.millisecondsSinceEpoch,
  }))).replaceAll('=', '');
  return '$cuerpo.firma-para-pruebas-locales';
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    SharedPreferences.setMockInitialValues({'preferencia.ajena': 'conservar'});
    AuthService.alTerminarSesion = null;
    await AuthService.cerrarSesion();
  });

  tearDown(() async {
    AuthService.alTerminarSesion = null;
    await AuthService.cerrarSesion();
  });

  test('Un token vigente sin padding mantiene la sesion', () {
    final vence = DateTime.now().add(const Duration(hours: 1));
    AuthService.token = tokenConVencimiento(vence);

    expect(AuthService.haySesion, isTrue);
    expect(AuthService.vencimiento?.millisecondsSinceEpoch, vence.millisecondsSinceEpoch);
    expect(AuthService.cabeceras['Authorization'], 'Bearer \${AuthService.token}');
  });

  test('Un token vencido no se envia en las peticiones', () {
    AuthService.token = tokenConVencimiento(DateTime.now().subtract(const Duration(minutes: 1)));

    expect(AuthService.haySesion, isFalse);
    expect(AuthService.cabeceras.containsKey('Authorization'), isFalse);
  });

  test('Tokens ausentes o malformados no producen una sesion', () {
    final valido = tokenConVencimiento(DateTime.now().add(const Duration(hours: 1)));
    for (final token in <String?>[null, '', 'sin-punto', '%%%.firma', 'e30.firma', '$valido.extra']) {
      AuthService.token = token;
      expect(AuthService.haySesion, isFalse, reason: 'Token rechazado: $token');
      expect(AuthService.vencimiento, isNull);
    }
  });

  test('recuperar conserva la sesion vigente y las preferencias ajenas', () async {
    final token = tokenConVencimiento(DateTime.now().add(const Duration(hours: 1)));
    SharedPreferences.setMockInitialValues({
      'sesion.token': token,
      'sesion.rol': 'PRUEBA',
      'sesion.nombre': 'Cuenta de prueba',
      'sesion.correo': 'prueba@example.test',
      'sesion.gestiona': true,
      'preferencia.ajena': 'conservar',
    });

    await AuthService.recuperar();

    expect(AuthService.haySesion, isTrue);
    expect(AuthService.token, token);
    expect(AuthService.rol, 'PRUEBA');
    expect(AuthService.nombre, 'Cuenta de prueba');
    expect(AuthService.correo, 'prueba@example.test');
    expect(AuthService.puedeGestionar, isTrue);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('preferencia.ajena'), 'conservar');
  });

  test('recuperar elimina una sesion vencida sin borrar preferencias ajenas', () async {
    SharedPreferences.setMockInitialValues({
      'sesion.token': tokenConVencimiento(DateTime.now().subtract(const Duration(minutes: 1))),
      'sesion.rol': 'PRUEBA',
      'sesion.nombre': 'Cuenta de prueba',
      'sesion.correo': 'prueba@example.test',
      'sesion.gestiona': true,
      'preferencia.ajena': 'conservar',
    });

    await AuthService.recuperar();

    expect(AuthService.haySesion, isFalse);
    expect(AuthService.token, isNull);
    expect(AuthService.rol, isNull);
    expect(AuthService.nombre, isNull);
    expect(AuthService.correo, isNull);
    expect(AuthService.puedeGestionar, isFalse);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getKeys(), {'preferencia.ajena'});
    expect(prefs.getString('preferencia.ajena'), 'conservar');
  });

  test('Varios 401 concurrentes provocan un solo regreso al login', () async {
    AuthService.token = tokenConVencimiento(DateTime.now().add(const Duration(hours: 1)));
    final iniciado = Completer<void>();
    final liberar = Completer<void>();
    var llamadas = 0;
    AuthService.alTerminarSesion = () async {
      llamadas += 1;
      iniciado.complete();
      await liberar.future;
    };

    // BaseService llama a este helper al recibir un 401; aqui no se usa la red.
    final cierres = List.generate(3, (_) => AuthService.terminarSesion());
    await iniciado.future;
    expect(llamadas, 1);
    liberar.complete();
    await Future.wait(cierres);
    await AuthService.terminarSesion();

    expect(llamadas, 1);
    expect(AuthService.haySesion, isFalse);
    expect(AuthService.token, isNull);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('preferencia.ajena'), 'conservar');
  });
}
`;
    }

    generateApiConfig() {
        return `import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;

/// URL de la API REST del backend Spring Boot generado desde el mismo diagrama.
class ApiConfig {
  static const Duration tiempoMaximo = Duration(seconds: 20);
  /// Para un celular real o un servidor en otra máquina:
  ///   flutter run --dart-define=API_URL=http://192.168.1.50:8080/api
  static const String _urlDefinida = String.fromEnvironment('API_URL');

  static String get baseUrl {
    if (_urlDefinida.isNotEmpty) return _urlDefinida;
    // El emulador de Android llega a la PC a través de 10.0.2.2
    if (!kIsWeb && Platform.isAndroid) return 'http://10.0.2.2:8080/api';
    return 'http://localhost:8080/api';
  }
}
`;
    }

    generateReadme(entidades = []) {
        const primera = entidades[0];
        const ejemplo = primera ? `/api/${rutaEntidad(primera.name)}` : '/api/...';
        const lista = entidades.map(e => `- **${etiquetaCampo(e.name)}**: \`lib/screens/${archivoDart(e.name)}_list_screen.dart\``).join('\n');
        return `# ${this.titulo}

App Flutter generada desde el diagrama de clases. Consume la API REST del
backend **Spring Boot** generado desde el mismo diagrama (puerto 8080).

## Puesta en marcha

1. **Backend**: descomprime el Spring Boot exportado, crea la base de datos y
   ejecuta \`mvnw spring-boot:run\`. Comprueba que responda
   \`http://localhost:8080${ejemplo}\` con el token de una sesión válida.
2. **Plataformas** (solo la primera vez; no sobrescribe \`lib/\`):
   \`\`\`bash
   flutter create .
   flutter pub get
   \`\`\`
3. **Ejecutar**:
   \`\`\`bash
   flutter run
   \`\`\`

## URL del backend

\`lib/config/api_config.dart\` usa \`http://localhost:8080/api\` (web, escritorio,
iOS) y \`http://10.0.2.2:8080/api\` en el emulador de Android. En un celular real,
indica la IP de la PC que corre Spring Boot:

\`\`\`bash
flutter run --dart-define=API_URL=http://192.168.1.50:8080/api
\`\`\`

## Pantallas

Cada entidad tiene listado, alta, edición y borrado. Las relaciones se eligen con
desplegables (claves foráneas) o chips (muchos a muchos), y los formularios
validan lo mismo que exige el backend.

${lista}

## Sesión y tiempos de espera

La app lee la fecha \`vence\` del token al arrancar, sin llamar a internet. Una sesión vencida
abre el login; un \`401\` durante el uso borra la sesión y vuelve al login una sola vez.
Las peticiones, incluido el asistente del servidor, tienen un límite de 20 segundos,
configurable en \`ApiConfig.tiempoMaximo\`. El asistente local sigue disponible sin conexión.

El selector de registro muestra solo los roles públicos informados por el backend.
Si no hay ninguno, las cuentas las crea quien administra. Para entrar en una demostración,
consulta las cuentas y la clave inicial en el README del backend; \`AUTH_DEMO=false\` desactiva
la creación de cuentas de prueba en el servidor.

## Estructura

\`\`\`
lib/
├── config/api_config.dart   URL del backend
├── models/                  mismo JSON que los DTO de Spring Boot
├── services/                peticiones HTTP (base_service.dart maneja errores)
├── screens/                 listado y formulario por entidad
└── main.dart
\`\`\`
`;
    }

    generateEntityList() {
        return '';
    }

    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

export default FlutterMainGenerator;
