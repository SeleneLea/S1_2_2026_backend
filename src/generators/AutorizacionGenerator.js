import { rutaEntidad } from './NombresReservados.js';

const cadena = valor => JSON.stringify(String(valor ?? ''));
const lista = valores => `java.util.List.of(${valores.map(cadena).join(', ')})`;
const conjunto = valores => `java.util.Set.of(${valores.map(cadena).join(', ')})`;

/** Infraestructura de autorización emitida únicamente con una política explícita. */
export function archivosAutorizacion(politica, entidades) {
    const reglas = Object.entries(politica.porRol).map(([rol, modulos]) =>
        `        java.util.Map.entry(${cadena(rol)}, java.util.Map.ofEntries(${Object.entries(modulos).map(([modulo, regla]) =>
            `\n            java.util.Map.entry(${cadena(modulo)}, new Regla(${conjunto(regla.acciones)}, ${cadena(regla.alcance)}, ${lista(regla.camino || [])}, ${cadena(regla.entidadTitular)}, ${cadena(regla.campoId || 'id')}))`
        ).join(',')}))`).join(',\n');
    const rutas = entidades.map(e => `java.util.Map.entry(${cadena('/api/' + rutaEntidad(e.name))}, ${cadena(e.name)})`).join(',\n        ');
    const titulares = politica.roles.filter(r => r.clase).map(r => `java.util.Map.entry(${cadena(r.rol)}, ${cadena(r.clase)})`).join(', ');
    return {
        'config/Permisos.java': `package com.example.demo.config;

/** Política del diagrama. Lo no declarado está denegado. */
public final class Permisos {
    private Permisos() {}
    public record Regla(java.util.Set<String> acciones, String alcance, java.util.List<String> camino, String titular, String campoId) {}
    public static final java.util.Set<String> ADMINISTRADORES = ${conjunto(politica.roles.filter(r => r.administrador).map(r => r.rol))};
    public static final java.util.Map<String, String> TITULARES = java.util.Map.ofEntries(${titulares});
    public static final java.util.Set<String> INVERSAS_EDITABLES = ${conjunto(entidades.filter(e => e.editarInversas).map(e => e.name))};
    public static final java.util.Map<String, String> RUTAS = java.util.Map.ofEntries(
        ${rutas});
    public static final java.util.Map<String, java.util.Map<String, Regla>> POR_ROL = java.util.Map.ofEntries(
${reglas});
    public static Regla de(String rol, String modulo) {
        return POR_ROL.getOrDefault(rol, java.util.Map.of()).get(modulo);
    }
    public static boolean puede(String rol, String modulo, String accion) {
        Regla regla = de(rol, modulo);
        return regla != null && !regla.alcance().equals("ninguno") && regla.acciones().contains(accion);
    }
    public static boolean requiereVinculo(String rol) {
        return POR_ROL.getOrDefault(rol, java.util.Map.of()).values().stream()
                .anyMatch(r -> r.alcance().equals("propios") || r.alcance().equals("asignados"));
    }
    public static String modulo(String ruta) {
        return RUTAS.keySet().stream().filter(r -> ruta.equals(r) || ruta.startsWith(r + "/"))
                .max(java.util.Comparator.comparingInt(String::length)).map(RUTAS::get).orElse(null);
    }
}
`,
        'exceptions/AccesoDenegadoException.java': `package com.example.demo.exceptions;

public class AccesoDenegadoException extends RuntimeException {
    public AccesoDenegadoException(String mensaje) { super(mensaje); }
}
`,
        'config/SesionActual.java': `package com.example.demo.config;

@org.springframework.stereotype.Component
@org.springframework.web.context.annotation.RequestScope
public class SesionActual {
    private final jakarta.servlet.http.HttpServletRequest peticion;
    public SesionActual(jakarta.servlet.http.HttpServletRequest peticion) { this.peticion = peticion; }
    public String rol() { return (String) peticion.getAttribute("usuarioRol"); }
    public String referenciaId() { return (String) peticion.getAttribute("usuarioReferenciaId"); }
}
`,
        'config/Autorizacion.java': `package com.example.demo.config;

import com.example.demo.exceptions.AccesoDenegadoException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.criteria.From;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.metamodel.Attribute;
import java.util.*;
import org.springframework.data.jpa.domain.Specification;

@org.springframework.stereotype.Component
public class Autorizacion {
    private final EntityManager em;
    private final SesionActual sesion;
    public Autorizacion(EntityManager em, SesionActual sesion) { this.em = em; this.sesion = sesion; }

    private Permisos.Regla exigir(String modulo, String accion) {
        String rol = sesion.rol();
        if (rol == null || !Permisos.puede(rol, modulo, accion))
            throw new AccesoDenegadoException("Tu rol no permite " + accion + " en " + modulo + ".");
        return Permisos.de(rol, modulo);
    }
    private String referencia() {
        String id = sesion.referenciaId();
        if (id == null || id.isBlank())
            throw new AccesoDenegadoException("Tu cuenta está pendiente de vinculación por administración.");
        return id;
    }
    public <T> Specification<T> alcance(String modulo, String accion) {
        Permisos.Regla regla = exigir(modulo, accion);
        if (regla.alcance().equals("todos")) return (raiz, consulta, cb) -> cb.conjunction();
        String titular = referencia();
        return (raiz, consulta, cb) -> {
            consulta.distinct(true);
            From<?, ?> destino = raiz;
            for (String paso : regla.camino()) destino = destino.join(paso, JoinType.INNER);
            var id = destino.get(regla.campoId());
            Class<?> tipoTitular = claseTitular(regla);
            var tipos = em.getMetamodel().getEntities().stream().map(t -> t.getJavaType())
                    .filter(tipoTitular::isAssignableFrom).toList();
            return cb.and(destino.type().in(tipos), cb.equal(id, convertir(titular, id.getJavaType())));
        };
    }

    private Object propiedad(Object entidad, String nombre) {
        try {
            String getter = "get" + Character.toUpperCase(nombre.charAt(0)) + nombre.substring(1);
            return entidad.getClass().getMethod(getter).invoke(entidad);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("La política refiere a una propiedad inexistente: " + nombre, e);
        }
    }
    private List<Object> recorrer(Object entidad, List<String> camino) {
        List<Object> actual = new ArrayList<>();
        if (entidad != null) actual.add(entidad);
        for (String paso : camino) {
            List<Object> siguiente = new ArrayList<>();
            for (Object objeto : actual) {
                Object valor = propiedad(objeto, paso);
                if (valor instanceof Collection<?> coleccion) siguiente.addAll(coleccion);
                else if (valor != null) siguiente.add(valor);
            }
            actual = siguiente;
        }
        return actual;
    }
    private boolean pertenece(Permisos.Regla regla, Object entidad, boolean todos) {
        if (regla.alcance().equals("todos")) return true;
        String id = referencia();
        List<Object> titulares = recorrer(entidad, regla.camino());
        if (titulares.isEmpty()) return false;
        Class<?> tipoTitular = claseTitular(regla);
        java.util.function.Predicate<Object> propio = valor -> tipoTitular.isAssignableFrom(org.hibernate.Hibernate.getClass(valor)) && id.equals(String.valueOf(propiedad(valor, regla.campoId())));
        return todos ? titulares.stream().allMatch(propio) : titulares.stream().anyMatch(propio);
    }
    private Class<?> claseTitular(Permisos.Regla regla) {
        try { return Class.forName("com.example.demo.entities." + regla.titular()); }
        catch (ClassNotFoundException e) { throw new IllegalStateException("Entidad titular desconocida", e); }
    }
    public void comprobar(String modulo, String accion, Object entidad) {
        Permisos.Regla regla = exigir(modulo, accion);
        if (!pertenece(regla, entidad, !accion.equals("ver")))
            throw new AccesoDenegadoException("El registro no está dentro de tu alcance en " + modulo + ".");
    }
    public <T> List<T> filtrar(String modulo, List<T> entidades) {
        Permisos.Regla regla = exigir(modulo, "ver");
        return entidades.stream().filter(e -> pertenece(regla, e, false)).toList();
    }

    /** Las cascadas JPA también son escrituras: se autoriza cada registro antes de borrar. */
    public void comprobarBorrado(String modulo, Object entidad) {
        comprobarBorrado(modulo, entidad, new HashSet<>());
    }
    private void comprobarBorrado(String modulo, Object entidad, Set<String> visitados) {
        String clave = modulo + ":" + em.getEntityManagerFactory().getPersistenceUnitUtil().getIdentifier(entidad);
        if (!visitados.add(clave)) return;
        comprobar(modulo, "borrar", entidad);
        for (Attribute<?, ?> attr : em.getMetamodel().entity(org.hibernate.Hibernate.getClass(entidad)).getAttributes()) {
            if (!attr.isAssociation()) continue;
            java.lang.reflect.AnnotatedElement miembro = (java.lang.reflect.AnnotatedElement) attr.getJavaMember();
            List<jakarta.persistence.CascadeType> cascadas = new ArrayList<>();
            var unoMuchos = miembro.getAnnotation(jakarta.persistence.OneToMany.class);
            var muchosUno = miembro.getAnnotation(jakarta.persistence.ManyToOne.class);
            var muchosMuchos = miembro.getAnnotation(jakarta.persistence.ManyToMany.class);
            var unoUno = miembro.getAnnotation(jakarta.persistence.OneToOne.class);
            if (unoMuchos != null) cascadas.addAll(Arrays.asList(unoMuchos.cascade()));
            if (muchosUno != null) cascadas.addAll(Arrays.asList(muchosUno.cascade()));
            if (muchosMuchos != null) cascadas.addAll(Arrays.asList(muchosMuchos.cascade()));
            if (unoUno != null) cascadas.addAll(Arrays.asList(unoUno.cascade()));
            if (!cascadas.contains(jakarta.persistence.CascadeType.REMOVE) && !cascadas.contains(jakarta.persistence.CascadeType.ALL)) continue;
            Object valor = propiedad(entidad, attr.getName());
            Collection<?> relacionados = valor instanceof Collection<?> c ? c : valor == null ? List.of() : List.of(valor);
            for (Object relacionado : relacionados)
                comprobarBorrado(org.hibernate.Hibernate.getClass(relacionado).getSimpleName(), relacionado, visitados);
        }
    }

    /** Captura únicamente los vínculos que pueden escribir los servicios generados. */
    public Map<String, Set<String>> relaciones(Object entidad) {
        Map<String, Set<String>> resultado = new HashMap<>();
        if (entidad == null) return resultado;
        Class<?> tipo = org.hibernate.Hibernate.getClass(entidad);
        for (Attribute<?, ?> attr : em.getMetamodel().entity(tipo).getAttributes()) {
            if (!attr.isAssociation()) continue;
            java.lang.reflect.AnnotatedElement miembro = (java.lang.reflect.AnnotatedElement) attr.getJavaMember();
            var unoMuchos = miembro.getAnnotation(jakarta.persistence.OneToMany.class);
            var muchosMuchos = miembro.getAnnotation(jakarta.persistence.ManyToMany.class);
            var unoUno = miembro.getAnnotation(jakarta.persistence.OneToOne.class);
            if (unoMuchos != null || (muchosMuchos != null && !muchosMuchos.mappedBy().isBlank() && !Permisos.INVERSAS_EDITABLES.contains(tipo.getSimpleName())) ||
                    (unoUno != null && !unoUno.mappedBy().isBlank())) continue;
            Object valor = propiedad(entidad, attr.getName());
            Collection<?> relacionados = valor instanceof Collection<?> c ? c : valor == null ? List.of() : List.of(valor);
            Set<String> ids = new HashSet<>();
            for (Object relacionado : relacionados) {
                Object id = em.getEntityManagerFactory().getPersistenceUnitUtil().getIdentifier(relacionado);
                if (id != null) ids.add(org.hibernate.Hibernate.getClass(relacionado).getSimpleName() + ":" + id);
            }
            resultado.put(attr.getName(), ids);
        }
        return resultado;
    }
    /** Un vínculo nuevo o retirado también requiere acceso al registro relacionado. */
    public void comprobarRelaciones(Object entidad, Map<String, Set<String>> antes) {
        if (Permisos.ADMINISTRADORES.contains(sesion.rol())) return;
        Map<String, Set<String>> despues = relaciones(entidad);
        Set<String> campos = new HashSet<>(antes.keySet()); campos.addAll(despues.keySet());
        for (String campo : campos) {
            Set<String> viejos = antes.getOrDefault(campo, Set.of()), nuevos = despues.getOrDefault(campo, Set.of());
            if (viejos.equals(nuevos)) continue;
            Set<String> cambios = new HashSet<>(viejos); cambios.addAll(nuevos);
            for (String clave : cambios) {
                int separador = clave.indexOf(':');
                String modulo = clave.substring(0, separador), id = clave.substring(separador + 1);
                Object relacionado = encontrar(modulo, id);
                if (relacionado == null) throw new AccesoDenegadoException("No puedes usar esa relación.");
                comprobar(modulo, "ver", relacionado);
            }
        }
    }
    public Object encontrar(String modulo, String id) {
        try {
            Class<?> tipo = Class.forName("com.example.demo.entities." + modulo);
            Class<?> tipoId = em.getMetamodel().entity(tipo).getIdType().getJavaType();
            return em.find(tipo, convertir(id, tipoId));
        } catch (ClassNotFoundException | IllegalArgumentException e) { return null; }
    }
    public static Object convertir(String valor, Class<?> tipo) {
        if (tipo == String.class) return valor;
        if (tipo == Long.class || tipo == long.class) return Long.valueOf(valor);
        if (tipo == Integer.class || tipo == int.class) return Integer.valueOf(valor);
        if (tipo == java.util.UUID.class) return java.util.UUID.fromString(valor);
        if (tipo == Double.class || tipo == double.class) return Double.valueOf(valor);
        if (tipo == Float.class || tipo == float.class) return Float.valueOf(valor);
        if (tipo == java.math.BigDecimal.class) return new java.math.BigDecimal(valor);
        if (tipo == java.time.LocalDate.class) return java.time.LocalDate.parse(valor);
        if (tipo == java.time.LocalDateTime.class) return java.time.LocalDateTime.parse(valor);
        if (tipo == java.time.LocalTime.class) return java.time.LocalTime.parse(valor);
        if (tipo == Boolean.class || tipo == boolean.class) {
            if (!valor.equals("true") && !valor.equals("false")) throw new IllegalArgumentException("Identificador booleano inválido");
            return Boolean.valueOf(valor);
        }
        throw new IllegalArgumentException("Tipo de identificador no admitido para permisos: " + tipo.getSimpleName());
    }
}
`,
        'config/VinculosCuenta.java': `package com.example.demo.config;

import com.example.demo.repositories.UsuarioRepository;
import jakarta.persistence.EntityManager;

@org.springframework.stereotype.Component
public class VinculosCuenta {
    private final EntityManager em;
    private final UsuarioRepository cuentas;
    public VinculosCuenta(EntityManager em, UsuarioRepository cuentas) { this.em = em; this.cuentas = cuentas; }
    public String validar(String rol, String referencia, Long cuentaId, boolean permitirPendiente) {
        if (referencia == null || referencia.isBlank()) {
            if (!permitirPendiente && Permisos.requiereVinculo(rol))
                throw new IllegalArgumentException("Este rol requiere un registro vinculado por administración.");
            return null;
        }
        String modulo = Permisos.TITULARES.get(rol);
        if (modulo == null) throw new IllegalArgumentException("Este rol no admite un registro vinculado.");
        try {
            Class<?> tipo = Class.forName("com.example.demo.entities." + modulo);
            Object id = Autorizacion.convertir(referencia, em.getMetamodel().entity(tipo).getIdType().getJavaType());
            Object registro = em.find(tipo, id);
            if (registro == null) throw new IllegalArgumentException("El registro que intentas vincular no existe.");
            String canonico = String.valueOf(em.getEntityManagerFactory().getPersistenceUnitUtil().getIdentifier(registro));
            boolean ocupado = cuentas.findAll().stream().anyMatch(c -> rol.equals(c.getRol()) && canonico.equals(c.getReferenciaId()) && !java.util.Objects.equals(c.getId(), cuentaId));
            if (ocupado) throw new IllegalArgumentException("Ese registro ya está vinculado a otra cuenta.");
            return canonico;
        } catch (ClassNotFoundException e) { throw new IllegalArgumentException("La entidad del rol no existe."); }
    }
    @org.springframework.transaction.annotation.Transactional
    public void vincularDemo() {
        for (var cuenta : cuentas.findAll()) {
            if (cuenta.getReferenciaId() != null || !cuenta.getCorreo().equals(cuenta.getRol().toLowerCase() + "@demo.com")) continue;
            String modulo = Permisos.TITULARES.get(cuenta.getRol());
            if (modulo == null) continue;
            try {
                Class<?> tipo = Class.forName("com.example.demo.entities." + modulo);
                String pk = em.getMetamodel().entity(tipo).getSingularAttributes().stream().filter(a -> a.isId()).findFirst().orElseThrow().getName();
                var candidatos = em.createQuery("select e from " + modulo + " e order by e." + pk, tipo).getResultList();
                for (Object registro : candidatos) {
                    String id = String.valueOf(em.getEntityManagerFactory().getPersistenceUnitUtil().getIdentifier(registro));
                    try { cuenta.setReferenciaId(validar(cuenta.getRol(), id, cuenta.getId(), false)); cuenta.setVinculoVerificado(true); cuentas.save(cuenta); break; }
                    catch (IllegalArgumentException e) { /* El registro ya pertenece a otra cuenta. */ }
                }
            } catch (ClassNotFoundException e) { throw new IllegalStateException(e); }
        }
    }
}
`,
        'config/VincularCuentasDemo.java': `package com.example.demo.config;

@org.springframework.stereotype.Component
@org.springframework.core.annotation.Order(30)
public class VincularCuentasDemo implements org.springframework.boot.CommandLineRunner {
    private final VinculosCuenta vinculos;
    @org.springframework.beans.factory.annotation.Value("\${app.auth.cuentas-demo:true}")
    private boolean demo;
    public VincularCuentasDemo(VinculosCuenta vinculos) { this.vinculos = vinculos; }
    public void run(String... args) { if (demo) vinculos.vincularDemo(); }
}
`
    };
}
