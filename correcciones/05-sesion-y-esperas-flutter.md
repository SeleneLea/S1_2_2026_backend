# 05 · Sesión vencida y peticiones sin tiempo máximo en la app Flutter

**Gravedad: media, pero es el arreglo más rentable de la lista:** son unas 60 líneas y se nota
en cuanto se usa la app.
**Archivos a tocar:** `src/generators/FlutterAuthGenerator.js`,
`src/generators/FlutterServiceGenerator.js`, `src/generators/FlutterMainGenerator.js`.

## Síntoma

1. **Sesión vencida que parece válida.** El token dura 12 horas
   (`app.auth.horas-sesion=12`). Al día siguiente, la app abre directo en el inicio como si la
   sesión siguiera viva; cada pantalla que se abre falla con "Inicia sesión para usar esta
   opción" y no hay manera de volver al login salvo cerrando sesión a mano.
2. **Peticiones que se quedan colgadas.** Si el backend no responde (teléfono en otra red, el
   servidor levantando, el túnel `adb reverse` caído), el círculo de carga gira para siempre.
   No hay tiempo máximo en ninguna petición.
3. **Un 401 en medio del uso no lleva al login.** Se ve el mensaje de error dentro de la
   pantalla y la app queda en un estado sin sesión pero con la interfaz de alguien conectado.

## Causa

### Sesión

`FlutterAuthGenerator.js:34` decide que hay sesión solo por la existencia del token:

```dart
static bool get haySesion => (token ?? '').isNotEmpty;
```

y `recuperar()` (`:43-51`) lo lee de `SharedPreferences` sin mirar si venció:

```dart
static Future<void> recuperar() async {
  final datos = await SharedPreferences.getInstance();
  token = datos.getString(_claveToken);
  ...
}
```

`main()` (`FlutterMainGenerator.js:25-29`) llama a `recuperar()` y decide la pantalla inicial
con ese `haySesion` (`:49`).

**El dato está a mano:** el token que emite el backend es
`base64url(json) + "." + base64url(HmacSHA256(json))` y el json trae `vence` en milisegundos
(`src/generators/AuthGenerator.js:225-236`). Se puede leer en el teléfono sin llamar al
servidor. Eso importa en este proyecto, que tiene que funcionar sin internet: la comprobación
de arranque debe ser **local**, no una llamada a `/api/auth/yo`.

La firma no se puede verificar en el cliente (el secreto está solo en el servidor) y no hace
falta: el servidor la valida en cada petición. En el cliente solo interesa la fecha, para no
mostrar una pantalla que va a fallar.

### Esperas

`BaseService._enviar` (`FlutterServiceGenerator.js:120-152`) no pone tiempo máximo:

```dart
Future<dynamic> _enviar(Future<http.Response> Function() peticion) async {
  http.Response respuesta;
  try {
    respuesta = await peticion();      // <- sin .timeout(...)
  } catch (_) {
    throw ApiException('No se pudo conectar con el backend en $baseUrl. ...');
  }
  ...
}
```

Tampoco `AuthService._pedir` ni `AuthService.roles()` (`FlutterAuthGenerator.js:88-115`),
que usan `http.post` / `http.get` directo.

### 401

`_enviar` sí distingue el código y lo guarda en `ApiException.status`
(`FlutterServiceGenerator.js:146-151`), pero nadie lo mira: cada pantalla muestra el mensaje y
ya. Es decir, la mitad del trabajo está hecha.

## Qué hacer

### Paso 1 — vencimiento en `AuthService` (generado por `FlutterAuthGenerator`)

```dart
  /// Momento en que vence el token. Sale del propio token, sin llamar al servidor:
  /// así la app sabe si la sesión sirve aunque esté sin internet.
  static DateTime? get vencimiento {
    final valor = token;
    if (valor == null || !valor.contains('.')) return null;
    try {
      final cuerpo = valor.split('.').first;
      final datos = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(cuerpo))));
      final vence = datos is Map ? datos['vence'] : null;
      if (vence is num) return DateTime.fromMillisecondsSinceEpoch(vence.toInt());
    } catch (_) {
      // token con otro formato: se trata como vencido
    }
    return null;
  }

  /// Hay sesión si hay token y todavía no venció.
  static bool get haySesion {
    if ((token ?? '').isEmpty) return false;
    final vence = vencimiento;
    return vence == null ? false : vence.isAfter(DateTime.now());
  }
```

`base64Url.normalize` es imprescindible: el backend firma con
`Base64.getUrlEncoder().withoutPadding()` (`AuthGenerator.js:261-263`) y `base64Url.decode`
exige el relleno.

Decisión a tomar con cuidado: si el token **no** trae `vence` (`vencimiento == null`),
`haySesion` devuelve `false`. Es lo correcto para tokens de otro formato, pero significa que un
token emitido por un backend viejo manda al login. Es aceptable y es el lado seguro.

### Paso 2 — `recuperar()` limpia lo que ya venció

```dart
  static Future<void> recuperar() async {
    final datos = await SharedPreferences.getInstance();
    token = datos.getString(_claveToken);
    rol = datos.getString(_claveRol);
    nombre = datos.getString(_claveNombre);
    correo = datos.getString(_claveCorreo);
    puedeGestionar = datos.getBool(_claveGestiona) ?? false;
    // Si la sesión guardada ya venció, se borra: si no, la app abría en el inicio
    // y cada pantalla fallaba con 401 sin explicar por qué.
    if ((token ?? '').isNotEmpty && !haySesion) await cerrarSesion();
  }
```

`cerrarSesion()` ya existe (`FlutterAuthGenerator.js:66-75`) y hace `prefs.clear()`.

### Paso 3 — tiempo máximo en un solo lugar

En `FlutterMainGenerator.generateApiConfig()`, junto a `baseUrl`:

```dart
class ApiConfig {
  static const String baseUrl = ...;
  /// Tiempo máximo de cada petición. Sin esto, una red caída deja el círculo de carga girando.
  static const Duration tiempoMaximo = Duration(seconds: 20);
}
```

En `BaseService._enviar`:

```dart
    try {
      respuesta = await peticion().timeout(ApiConfig.tiempoMaximo);
    } on TimeoutException {
      throw ApiException(
        'El servidor tardó demasiado en responder (más de '
        '\${ApiConfig.tiempoMaximo.inSeconds} segundos). Revisa la conexión e inténtalo de nuevo.',
      );
    } catch (_) {
      throw ApiException('No se pudo conectar con el backend en $baseUrl. ...');
    }
```

Hace falta `import 'dart:async';` en el archivo del servicio base, o `TimeoutException` no
existe y `flutter analyze` falla. Aplicar el mismo `.timeout(ApiConfig.tiempoMaximo)` a
`AuthService._pedir` y a `AuthService.roles()`; en `roles()`, que ya devuelve lista vacía ante
cualquier error, alcanza con que el `catch (_)` cubra el timeout.

20 segundos es un valor razonable para un backend que arranca en frío; si se elige otro, que
quede en `ApiConfig` y no repartido.

### Paso 4 — 401 centralizado que devuelve al login

En `main.dart` (`FlutterMainGenerator.generateMain()`), una llave de navegación global:

```dart
/// Permite volver al login desde cualquier parte cuando la sesión vence.
final GlobalKey<NavigatorState> navegador = GlobalKey<NavigatorState>();

...
    return MaterialApp(
      navigatorKey: navegador,
      ...
    );
```

Y una función que la app pueda llamar sin `context`:

```dart
/// Cierra la sesión y vuelve al login, descartando las pantallas abiertas.
Future<void> volverAlLogin() async {
  await AuthService.cerrarSesion();
  final estado = navegador.currentState;
  if (estado == null) return;
  await estado.pushAndRemoveUntil(
    MaterialPageRoute(builder: (_) => const LoginScreen()),
    (ruta) => false,
  );
}
```

Dónde ponerla: lo más limpio es un archivo nuevo `lib/sesion_vencida.dart` que importe
`AuthService` y `LoginScreen`, para que `base_service.dart` no tenga que importar `main.dart`
(importar main desde un servicio compila, pero deja una dependencia circular incómoda y
`flutter analyze` la marca como `unnecessary_import` en algunos casos).

En `BaseService._enviar`, antes de lanzar la excepción de error:

```dart
    if (respuesta.statusCode == 401) {
      // La sesión venció o el token no sirve: se cierra y se vuelve al login una sola vez.
      await volverAlLogin();
      throw ApiException('Tu sesión terminó. Vuelve a iniciar sesión.', status: 401);
    }
```

Cuidado con dos cosas:

- **No entrar en bucle.** `volverAlLogin()` no debe disparar otra petición. Si varias
  peticiones fallan a la vez, todas llaman a `volverAlLogin()`; poner una bandera estática
  (`static bool _volviendo = false;`) para que solo la primera navegue.
- **El login no debe usar `BaseService`.** `AuthService._pedir` usa `http` directo, así que el
  401 del propio login (clave equivocada) no pasa por aquí. Eso ya está bien como está.

### Paso 5 — mostrar en el inicio cuándo vence

Opcional y barato: en `home_screen.dart`, donde hoy se muestra
"Cuenta de prueba medico · MEDICO", agregar la hora de vencimiento. Ayuda en la defensa del
trabajo y hace visible que la comprobación existe.

## Criterio de aceptación

Con un backend generado levantado y la app corriendo (en web alcanza para 1, 2 y 3):

1. **Sesión vencida al abrir:** iniciar sesión, cerrar la app, y arrancar el backend con
   `-Dapp.auth.horas-sesion=0` (o adelantar el reloj del dispositivo). Al abrir la app, aparece
   el **login**, no el inicio.
2. **Sesión vigente al abrir:** con las 12 horas normales, cerrar y volver a abrir la app →
   entra directo al inicio, como hoy.
3. **401 en uso:** con la app abierta en una lista, reiniciar el backend con un
   `AUTH_SECRET` distinto (los tokens viejos dejan de valer) y refrescar la lista → la app
   vuelve al login con el mensaje "Tu sesión terminó".
4. **Tiempo máximo:** apagar el backend y abrir una lista → a los ~20 segundos aparece el
   mensaje de que el servidor tardó demasiado, y el círculo de carga desaparece. Sin el
   arreglo, gira indefinidamente.
5. `flutter analyze` → `No issues found!` en los cinco tableros de ejemplo (es donde se ve si
   faltó el `import 'dart:async';` o quedó un import circular).
6. La app sigue entrando con `<rol>@demo.com` / `12345678` y el botón de cerrar sesión sigue
   funcionando.

## Riesgos y qué no tocar

- **No verificar la firma en el cliente.** Haría falta el secreto en el teléfono, que es
  exactamente lo que no debe estar ahí. El servidor la verifica en cada petición.
- **No llamar al backend al arrancar** para comprobar la sesión: la app tiene que abrir sin
  internet. La comprobación es local, con la fecha del token.
- **No tocar el formato del token ni `SharedPreferences`.** Las claves guardadas
  (`sesion.token`, `sesion.rol`, …) se quedan como están.
- Al agregar `navigatorKey`, revisar que las pantallas que hacen `Navigator.of(context)` sigan
  igual; la llave global es un añadido, no un reemplazo.
