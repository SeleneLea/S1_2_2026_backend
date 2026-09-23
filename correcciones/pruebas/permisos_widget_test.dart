import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:permisos/screens/home_screen.dart';
import 'package:permisos/screens/plan_list_screen.dart';
import 'package:permisos/screens/objetivo_form_screen.dart';
import 'package:permisos/models/objetivo.dart';
import 'package:permisos/services/auth_service.dart';

Future<http.Response> respuestaDePrueba(http.Request peticion) async {
  final lista = peticion.url.path.endsWith('/plan')
      ? [{'id': 101, 'nombre': 'Plan propio visible', 'semanas': 6, 'objetivoId': 21}]
      : [{'id': 21, 'nombre': 'Objetivo propio', 'notaVentaId': 11}];
  final esDetalle = RegExp(r'/\d+$').hasMatch(peticion.url.path);
  return http.Response(jsonEncode({
    'success': true, 'data': esDetalle ? lista.first : lista,
    'total': lista.length, 'pagina': 0, 'hayMas': false,
  }), 200, headers: {'content-type': 'application/json; charset=utf-8'});
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    AuthService.rol = 'CLIENTE';
    // La tabla por módulo debe prevalecer incluso sobre un indicador global obsoleto.
    AuthService.puedeGestionar = true;
    AuthService.alTerminarSesion = null;
  });

  tearDown(() async {
    await AuthService.cerrarSesion();
  });

  testWidgets('Cliente solo ve Cliente, Objetivo y Plan en el menú', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: HomeScreen()));
    final titulos = tester.widgetList<ListTile>(find.byType(ListTile))
        .map((tile) => (tile.title! as Text).data).toList();
    expect(titulos, unorderedEquals(['Cliente', 'Objetivo', 'Plan']));
    expect(find.text('Entrenador'), findsNothing);
    expect(find.text('Nota venta'), findsNothing);

    AuthService.rol = 'ADMIN';
    await tester.pumpWidget(MaterialApp(home: HomeScreen(key: UniqueKey())));
    expect(find.text('Entrenador'), findsOneWidget);
    expect(find.text('Nota venta'), findsOneWidget);
  });

  testWidgets('Cliente abre el detalle de Plan sin crear, editar ni borrar', (tester) async {
    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: PlanListScreen()));
      await tester.pumpAndSettle();
      expect(find.textContaining('Plan propio visible'), findsOneWidget);
      expect(find.byType(FloatingActionButton), findsNothing);
      expect(find.byTooltip('Eliminar'), findsNothing);
      expect(find.byTooltip('Nuevo'), findsNothing);

      await tester.tap(find.textContaining('Plan propio visible'));
      await tester.pumpAndSettle();
      expect(find.text('Detalle de Plan'), findsOneWidget);
      expect(find.text('Actualizar'), findsNothing);
      expect(find.text('Guardar'), findsNothing);
      expect(tester.widgetList<AbsorbPointer>(find.byType(AbsorbPointer))
          .any((widget) => widget.absorbing), isTrue);
    }, () => MockClient(respuestaDePrueba));
  });

  testWidgets('Una relación de módulo denegado conserva su ID sin consultar ese módulo', (tester) async {
    final consultas = <String>[];
    await http.runWithClient(() async {
      await tester.pumpWidget(MaterialApp(home: ObjetivoFormScreen(
        registro: Objetivo(id: 21, nombre: 'Objetivo propio', notaVentaId: 11),
      )));
      await tester.pumpAndSettle();
      expect(find.text('Detalle de Objetivo'), findsOneWidget);
      expect(consultas.where((ruta) => ruta.contains('nota-venta')), isEmpty);
      expect(find.text('Actualizar'), findsNothing);
      expect(find.textContaining('11'), findsWidgets);
    }, () => MockClient((peticion) async {
      consultas.add(peticion.url.path);
      return respuestaDePrueba(peticion);
    }));
  });

  test('Recuperar sesión actualiza el rol desde el servidor y lo conserva localmente', () async {
    final token = '${base64Url.encode(utf8.encode(jsonEncode({
      'vence': DateTime.now().add(const Duration(hours: 1)).millisecondsSinceEpoch,
    }))).replaceAll('=', '')}.firma-local';
    SharedPreferences.setMockInitialValues({'sesion.token': token, 'sesion.rol': 'CLIENTE'});
    await http.runWithClient(() async {
      await AuthService.recuperar();
      expect(AuthService.rol, 'ENTRENADOR');
      expect(AuthService.haySesion, isTrue);
      expect((await SharedPreferences.getInstance()).getString('sesion.rol'), 'ENTRENADOR');
    }, () => MockClient((peticion) async => http.Response(jsonEncode({
      'success': true, 'data': {'rol': 'ENTRENADOR', 'puedeGestionar': true},
    }), 200)));
  });
}
