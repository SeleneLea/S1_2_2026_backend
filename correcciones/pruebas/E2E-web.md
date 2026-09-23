# Guion Flutter web → Spring Boot

Ejecutar antes de entregar cambios del generador y registrar fecha, commit, navegador y
resultado. Este guion verifica el contrato real entre pantallas y API.

## Preparación

1. Ejecutar `npm run pruebas:generar -- relaciones-opcionales validaciones fechas-y-horas`.
2. Ejecutar `pruebas:backend`, `pruebas:flutter` y `pruebas:integracion` con ese manifest.
3. Arrancar el Spring elegido con la base indicada en su `integracion.json`, sus credenciales
   locales, `SERVER_PORT=8091` y `AUTH_DEMO=true`. Dentro del Spring, con las variables
   de datasource ya definidas, usar `mvnw.cmd spring-boot:run` (Linux: `./mvnw`).
4. En otra terminal, dentro del Flutter indicado por el manifest:

   ```text
   flutter create . --platforms web
   flutter pub get
   flutter run -d chrome --web-port=8099 --dart-define=API_URL=http://localhost:8091/api
   ```

## Operaciones

1. Consultar `/api/auth/roles` y entrar con `<gestor>@demo.com` / `12345678`. El registro
   público no debe ofrecer roles de gestión.
2. En Productos, crear un registro y asignarle dos categorías. Recargar: debe persistir.
   Editar, desmarcar ambas, guardar y volver a abrir: debe mostrar ninguna. En Red, comprobar
   que el PUT envió `categoriaIds: []` y el GET posterior devolvió una lista vacía.
3. En Pedido, quitar su Cliente opcional. Comprobar `clienteId: null` tanto en el PUT como
   en el GET posterior. Completar los demás campos requeridos.
4. Buscar una relación y cargar más opciones. Una opción ya elegida debe mantenerse aunque
   no aparezca en la primera página. Los listados deben paginar y buscar sin perder filtros.
5. En `validaciones`, guardar temperatura `-12.5` con observación vacía: debe aceptar.
   Temperatura `120`, porcentaje `101` y código de más de 20 caracteres deben rechazarse.
   Repetir un código ya usado debe mostrar el conflicto devuelto por el servidor.
6. En `fechas-y-horas`, guardar fecha, fecha/hora y hora; reabrir y comprobar sus formatos
   y que la zona horaria no desplazó la fecha.
7. Con un rol de consulta, comprobar ausencia de acciones de escritura y respuesta 403
   si se intenta modificar manualmente desde Red.
8. Con sesión abierta, reiniciar ese backend de prueba con otra `AUTH_SECRET`. La siguiente
   petición debe llevar al login con un aviso único y sin pantallas protegidas en el historial.
9. En el almacenamiento local del navegador de prueba, sustituir `vence` del token por una
   fecha pasada y recargar sin internet: debe mostrar login. Repetir con un token malformado.
   Esta comprobación local no sustituye la firma, que siempre valida el servidor.
10. Detener el backend y ejecutar una acción: debe acabar con error dentro del límite
    configurado, sin indicador de carga permanente. Arrancar y reintentar.

Detener ambas terminales con Ctrl+C. No adjuntar tokens, contraseñas ni `.env` al informe.
No hace falta publicar ni instalar la aplicación en un teléfono.
