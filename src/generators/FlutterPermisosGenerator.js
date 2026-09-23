import { textoDart } from './FlutterNombres.js';

/** Serializa la política resuelta por Permisos.js, sin volver a deducir autorizaciones. */
export const permisosDart = politica => {
    const cadena = valor => `'${textoDart(valor)}'`;
    const roles = Object.entries(politica.porRol).map(([rol, modulos]) =>
        `    ${cadena(rol)}: {\n${Object.entries(modulos).map(([modulo, regla]) =>
            `      ${cadena(modulo)}: ReglaPermiso({${regla.acciones.map(cadena).join(', ')}}, ${cadena(regla.alcance)}, [${(regla.camino || []).map(cadena).join(', ')}]),`
        ).join('\n')}\n    },`
    ).join('\n');
    const administradores = politica.roles.filter(r => r.administrador).map(r => cadena(r.rol)).join(', ');
    return `/// Misma tabla que aplica el backend; el servidor también comprueba el propietario.
class ReglaPermiso {
  final Set<String> acciones;
  final String alcance;
  final List<String> camino;
  const ReglaPermiso(this.acciones, this.alcance, this.camino);
}

class Permisos {
  static const bool explicitos = ${politica.explicito === true};
  static const Set<String> administradores = {${administradores}};
  static const Map<String, Map<String, ReglaPermiso>> porRol = {
${roles}
  };

  static bool puede(String? rol, String modulo, String accion) {
    final regla = porRol[rol]?[modulo];
    return regla != null && regla.alcance != 'ninguno' && regla.acciones.contains(accion);
  }

  static bool puedeUsarAsistente(String? rol) =>
      rol != null && (!explicitos || administradores.contains(rol));

  static bool requiereVinculacion(String? rol) => explicitos &&
      (porRol[rol]?.values.any((regla) => regla.alcance == 'propios' || regla.alcance == 'asignados') ?? false);
}
`;
};
