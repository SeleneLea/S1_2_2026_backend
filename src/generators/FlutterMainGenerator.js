import { archivoDart, etiquetaCampo, textoDart } from './FlutterNombres.js';

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

import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'services/auth_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Si ya se inició sesión antes, la app abre directo en el inicio
  await AuthService.recuperar();
  runApp(const MiApp());
}

class MiApp extends StatelessWidget {
  const MiApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '${textoDart(this.titulo)}',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
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

    // Prueba propia: sin ella, "flutter create ." añade una de ejemplo que no compila con esta app
    generateWidgetTest() {
        return `import 'package:flutter_test/flutter_test.dart';

import 'package:${this.projectName}/main.dart';

void main() {
  testWidgets('La app arranca en la pantalla principal', (tester) async {
    await tester.pumpWidget(const MiApp());
    expect(find.text('${textoDart(this.titulo)}'), findsWidgets);
  });
}
`;
    }

    generateApiConfig() {
        return `import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;

/// URL de la API REST del backend Spring Boot generado desde el mismo diagrama.
class ApiConfig {
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
        const ejemplo = primera ? `/api/${primera.name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}` : '/api/...';
        const lista = entidades.map(e => `- **${etiquetaCampo(e.name)}**: \`lib/screens/${archivoDart(e.name)}_list_screen.dart\``).join('\n');
        return `# ${this.titulo}

App Flutter generada desde el diagrama de clases. Consume la API REST del
backend **Spring Boot** generado desde el mismo diagrama (puerto 8080).

## Puesta en marcha

1. **Backend**: descomprime el Spring Boot exportado, crea la base de datos y
   ejecuta \`mvnw spring-boot:run\`. Comprueba que responda
   \`http://localhost:8080${ejemplo}\`.
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
