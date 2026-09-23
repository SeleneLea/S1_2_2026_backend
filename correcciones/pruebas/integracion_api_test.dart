import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:relaciones_opcionales/models/producto.dart';
import 'package:relaciones_opcionales/services/auth_service.dart';
import 'package:relaciones_opcionales/services/entidad_producto_service.dart';
import 'package:relaciones_opcionales/services/entidad_categoria_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // Esta prueba usa exclusivamente el backend temporal de la batería.
  HttpOverrides.global = null;

  test('Flutter crea, pagina y vacía relaciones contra Spring Boot', () async {
    SharedPreferences.setMockInitialValues({});
    final error = await AuthService.entrar('empleado@demo.com', '12345678');
    expect(error, isNull);
    expect(AuthService.haySesion, isTrue);
    final categorias = await ApiCategoriaService().getPagina(tamano: 1);
    expect(categorias.items, hasLength(1));
    final servicio = ApiProductoService();
    final creado = await servicio.create(Producto(
      nombre: 'Contrato Flutter Spring', precio: 19.5,
      categoriaIds: [categorias.items.first.id!],
    ));
    expect(creado.id, isNotNull);
    expect(creado.categoriaIds, hasLength(1));
    final pagina = await servicio.getPagina(buscar: 'Contrato Flutter Spring', tamano: 1);
    expect(pagina.total, 1);
    expect(pagina.items.first.id, creado.id);
    final actualizado = await servicio.update(creado.id!, creado.copyWith(categoriaIds: []));
    expect(actualizado.categoriaIds, isEmpty);
    expect((await servicio.getById(creado.id!)).categoriaIds, isEmpty);
    await servicio.delete(creado.id!);
    expect((await servicio.getPagina(buscar: 'Contrato Flutter Spring')).total, 0);
    await AuthService.cerrarSesion();
  });
}
