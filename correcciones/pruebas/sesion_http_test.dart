import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:permisos/config/permisos.dart';
import 'package:permisos/services/auth_service.dart';
import 'package:permisos/services/base_service.dart';

// Transporta HTTP real por loopback. Solo cambia el destino para aislar la prueba del backend.
class _ClienteLocal extends http.BaseClient {
  final int puerto;
  final _cliente = IOClient();
  _ClienteLocal(this.puerto);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest original) async {
    final destino = original.url.replace(scheme: 'http', host: '127.0.0.1', port: puerto);
    final peticion = http.StreamedRequest(original.method, destino);
    peticion.headers.addAll(original.headers);
    final respuesta = _cliente.send(peticion);
    await peticion.sink.addStream(original.finalize());
    await peticion.sink.close();
    return respuesta;
  }

  @override
  void close() => _cliente.close();
}

// El binding de Flutter sustituye HttpClient por un 400; estas pruebas usan el socket local.
class _RedLocal extends HttpOverrides {}

Future<T> conRedLocal<T>(HttpServer servidor, Future<T> Function() prueba) =>
    HttpOverrides.runWithHttpOverrides(
      () => http.runWithClient(prueba, () => _ClienteLocal(servidor.port)),
      _RedLocal(),
    );

String tokenVigente(String rol) {
  final cuerpo = base64Url.encode(utf8.encode(jsonEncode({
    'correo': 'prueba@example.test', 'rol': rol,
    'vence': DateTime.now().add(const Duration(hours: 1)).millisecondsSinceEpoch,
  }))).replaceAll('=', '');
  return '$cuerpo.firma-local';
}

Future<void> responder(HttpRequest peticion, int estado, Map<String, dynamic> cuerpo) async {
  peticion.response.statusCode = estado;
  peticion.response.headers.contentType = ContentType.json;
  peticion.response.write(jsonEncode(cuerpo));
  await peticion.response.close();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({'preferencia.ajena': 'conservar'});
    AuthService.alTerminarSesion = null;
    AuthService.token = tokenVigente('ADMIN');
    AuthService.rol = 'ADMIN';
    AuthService.puedeGestionar = true;
  });

  tearDown(() async {
    AuthService.alTerminarSesion = null;
    await AuthService.cerrarSesion();
  });

  test('Tres HTTP 401 invalidan la sesión y notifican una sola vez', () async {
    final servidor = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => servidor.close(force: true));
    final recibidas = Completer<void>();
    var peticiones = 0;
    final erroresServidor = <Object>[];
    servidor.listen((peticion) async {
      try {
        expect(peticion.headers.value('authorization'), startsWith('Bearer '));
        peticiones++;
        if (peticiones == 3) recibidas.complete();
        await recibidas.future;
        await responder(peticion, 401, {'success': false, 'message': 'La cuenta ya no existe.'});
      } catch (error) { erroresServidor.add(error); }
    });
    final notificado = Completer<void>();
    final liberar = Completer<void>();
    var cierres = 0;
    AuthService.alTerminarSesion = () async {
      cierres++;
      if (!notificado.isCompleted) notificado.complete();
      await liberar.future;
    };
    await conRedLocal(servidor, () async {
      final solicitudes = Future.wait(List.generate(3, (_) async {
        try { return await BaseService().getData('/plan'); }
        catch (error) { return error; }
      }));
      await notificado.future.timeout(const Duration(seconds: 5));
      liberar.complete();
      final resultados = await solicitudes;
      expect(resultados, everyElement(isA<ApiException>().having((e) => e.status, 'status', 401)));
    });
    expect(erroresServidor, isEmpty);
    expect(peticiones, 3);
    expect(cierres, 1);
    expect(AuthService.token, isNull);
    expect(AuthService.rol, isNull);
    expect(AuthService.puedeGestionar, isFalse);
    expect(AuthService.cabeceras.containsKey('Authorization'), isFalse);
    expect((await SharedPreferences.getInstance()).getString('preferencia.ajena'), 'conservar');
  });

  test('Una respuesta tardía de auth/yo no restaura una sesión cerrada', () async {
    final servidor = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => servidor.close(force: true));
    final recibida = Completer<void>();
    final responderAhora = Completer<void>();
    servidor.listen((peticion) async {
      recibida.complete();
      await responderAhora.future;
      await responder(peticion, 200, {'success': true, 'data': {
        'token': tokenVigente('ADMIN'), 'rol': 'ADMIN', 'puedeGestionar': true,
        'correo': 'prueba@example.test', 'referenciaId': null,
      }});
    });
    await conRedLocal(servidor, () async {
      final actualizacion = AuthService.actualizarSesion();
      await recibida.future.timeout(const Duration(seconds: 5));
      await AuthService.cerrarSesion();
      responderAhora.complete();
      await actualizacion;
    });
    expect(AuthService.token, isNull);
    expect(AuthService.rol, isNull);
    expect(AuthService.puedeGestionar, isFalse);
    expect((await SharedPreferences.getInstance()).containsKey('sesion.token'), isFalse);
  });

  test('El rol revocado y la vinculación pendiente se recuperan desde HTTP', () async {
    final servidor = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => servidor.close(force: true));
    var peticiones = 0;
    servidor.listen((peticion) async {
      peticiones++;
      await responder(peticion, 200, {'success': true, 'data': {
        'token': tokenVigente('CLIENTE'), 'rol': 'CLIENTE', 'puedeGestionar': false,
        'correo': 'prueba@example.test', 'referenciaId': null,
      }});
    });
    await conRedLocal(servidor, AuthService.actualizarSesion);
    expect(peticiones, 1);
    expect(AuthService.rol, 'CLIENTE');
    expect(AuthService.puedeGestionar, isFalse);
    expect(Permisos.puede(AuthService.rol, 'Plan', 'editar'), isFalse);
    expect(AuthService.vinculacionPendiente, isTrue);
    expect(Permisos.requiereVinculacion(AuthService.rol), isTrue);
    expect(Permisos.requiereVinculacion('ADMIN'), isFalse);
    final preferencias = await SharedPreferences.getInstance();
    expect(preferencias.getString('sesion.rol'), 'CLIENTE');
    expect(preferencias.getBool('sesion.vinculacionPendiente'), isTrue);
  });
}
