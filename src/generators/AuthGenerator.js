import { randomBytes } from 'node:crypto';
/**
 * Inicio de sesión con roles en el proyecto generado.
 *
 * El diagrama dice quiénes son las personas del sistema (Cliente, Entrenador, Médico, Docente…).
 * A partir de esas clases se genera:
 *   - una tabla `usuario` con correo, clave y rol;
 *   - endpoints /api/auth/registro, /api/auth/login y /api/auth/yo;
 *   - un filtro que exige el token en el resto de la API y limita quién puede modificar datos.
 *
 * Quién puede escribir: los roles de personal (entrenador, empleado, docente, médico, admin…).
 * Los demás roles (cliente, socio, paciente, alumno…) entran y consultan. Se cambia en
 * application.properties con app.auth.roles-gestores.
 */

// Clases que representan a alguien que entra al sistema
const ES_PERSONA = /cliente|usuario|persona|empleado|entrenador|profesor|docente|maestro|estudiante|alumno|socio|paciente|medico|doctor|vendedor|cajero|gerente|administrador|admin|instructor|tutor|chofer|conductor|mesero|recepcionista/i;
// De esas, las que además gestionan (crean, editan y borran)
const ES_GESTOR = /empleado|entrenador|profesor|docente|maestro|medico|doctor|vendedor|cajero|gerente|administrador|admin|instructor|tutor|recepcionista/i;

const SIN_TILDES = (texto) => String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ñ/gi, 'n');

/** Roles detectados en el diagrama. Si no hay ninguna clase de personas, queda un ADMIN. */
export const detectarRoles = (entidades = []) => {
    const roles = entidades
        .filter((e) => ES_PERSONA.test(SIN_TILDES(e.name)))
        .map((e) => ({
            clase: e.name,
            rol: SIN_TILDES(e.name).toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
            gestor: ES_GESTOR.test(SIN_TILDES(e.name)),
        }));
    if (!roles.length) return [{ clase: null, rol: 'ADMIN', gestor: true }];
    // Administración explícita: nunca ascender un Cliente/Paciente por quedar primero.
    if (!roles.some((r) => r.gestor)) roles.push({ clase: null, rol: 'ADMIN', gestor: true, administrador: true });
    return roles;
};

const lista = (valores) => valores.map((v) => `"${v}"`).join(', ');

export const entidadUsuario = (politica = null) => `package com.example.demo.entities;

import jakarta.persistence.*;

/**
 * Cuenta para entrar al sistema. El rol sale de las clases de personas del diagrama y decide
 * qué puede hacer: todos consultan, solo los roles de gestión crean, editan y borran.
 */
@Entity
@Table(name = "usuario", uniqueConstraints = ${politica?.explicito ? '{@UniqueConstraint(columnNames = "correo"), @UniqueConstraint(columnNames = {"rol", "referencia_id"})}' : '@UniqueConstraint(columnNames = "correo")'})
public class Usuario {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "correo", nullable = false, length = 180)
    private String correo;

    /** Clave protegida con PBKDF2; nunca se guarda tal cual. */
    @Column(name = "clave", nullable = false, length = 255)
    private String clave;

    @Column(name = "rol", nullable = false, length = 60)
    private String rol;

    @Column(name = "nombre", length = 180)
    private String nombre;

    /** Id del registro de esa persona en su propia tabla (opcional). */
    @Column(name = "referencia_id", length = 255)
    private String referenciaId;
${politica?.explicito ? `
    /** Los enlaces antiguos o declarados por el usuario no acreditan titularidad. */
    @Column(name = "vinculo_verificado", nullable = false, columnDefinition = "boolean default false")
    private boolean vinculoVerificado = false;

    public boolean isVinculoVerificado() { return vinculoVerificado; }
    public void setVinculoVerificado(boolean valor) { this.vinculoVerificado = valor; }
` : ''}

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getCorreo() { return correo; }
    public void setCorreo(String correo) { this.correo = correo; }
    public String getClave() { return clave; }
    public void setClave(String clave) { this.clave = clave; }
    public String getRol() { return rol; }
    public void setRol(String rol) { this.rol = rol; }
    public String getNombre() { return nombre; }
    public void setNombre(String nombre) { this.nombre = nombre; }
    public String getReferenciaId() { return referenciaId; }
    public void setReferenciaId(String referenciaId) { this.referenciaId = referenciaId; }
}
`;

export const repositorioUsuario = () => `package com.example.demo.repositories;

import com.example.demo.entities.Usuario;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface UsuarioRepository extends JpaRepository<Usuario, Long> {
    Optional<Usuario> findByCorreoIgnoreCase(String correo);
    boolean existsByCorreoIgnoreCase(String correo);
}
`;

export const servicioAuth = (roles, politica = null) => `package com.example.demo.services;

import com.example.demo.entities.Usuario;
import com.example.demo.repositories.UsuarioRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Optional;

/**
 * Cuentas, claves y tokens. Sin librerías extra: la clave se protege con PBKDF2 y el token
 * se firma con HMAC-SHA256, los dos incluidos en Java.
 */
@Service
public class AuthService {

    /** Roles que existen en este sistema, sacados de las clases de personas del diagrama. */
    public static final List<String> ROLES = List.of(${lista(roles.map((r) => r.rol))});

    private final UsuarioRepository repository;
${politica?.explicito ? `    @Autowired
    private com.example.demo.config.VinculosCuenta vinculos;` : ''}
    private final ObjectMapper json = new ObjectMapper();
    private final SecureRandom azar = new SecureRandom();

    /** Roles que pueden crear, editar y borrar. El resto solo consulta. */
    @Value("\${app.auth.roles-gestores:${roles.filter((r) => r.gestor).map((r) => r.rol).join(',')}}")
    private String rolesGestores;

    @Value("\${app.auth.roles-registro-publico:}")
    private String rolesRegistroPublico;

    @Value("\${AUTH_INICIAL_CORREO:}")
    private String correoInicial;

    @Value("\${AUTH_INICIAL_CLAVE:}")
    private String claveInicial;

    @Value("\${app.auth.secreto:}")
    private String secretoConfigurado;

    @Value("\${app.auth.horas-sesion:12}")
    private long horasSesion;

    /** Cuentas de ejemplo al arrancar con la base vacía (útil para probar y para la defensa). */
    @Value("\${app.auth.cuentas-demo:true}")
    private boolean cuentasDemo;

    @Value("\${app.auth.clave-demo:12345678}")
    private String claveDemo;

    private byte[] secreto;

    @Autowired
    public AuthService(UsuarioRepository repository) {
        this.repository = repository;
    }

    @PostConstruct
    void preparar() {
        if (secretoConfigurado == null || secretoConfigurado.isBlank()) {
            secreto = new byte[48];
            azar.nextBytes(secreto);
            System.out.println("Sin AUTH_SECRET: las sesiones se cerrarán al reiniciar.");
        } else {
            secreto = secretoConfigurado.getBytes(StandardCharsets.UTF_8);
        }
        if (!cuentasDemo && ${politica?.explicito ? 'repository.findAll().stream().noneMatch(u -> com.example.demo.config.Permisos.ADMINISTRADORES.contains(u.getRol()))' : 'repository.count() == 0'} && !correoInicial.isBlank()) {
            String gestor = ROLES.stream().filter(${politica?.explicito ? 'com.example.demo.config.Permisos.ADMINISTRADORES::contains' : 'this::puedeGestionar'}).findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("Configura un rol de gestión antes de crear la cuenta inicial."));
            crearCuenta(correoInicial, claveInicial, gestor, "Administración", null);
        }
        if (cuentasDemo) System.out.println("Cuentas de prueba activas. Para publicar: AUTH_DEMO=false.");
        if (cuentasDemo && repository.count() == 0) {
            for (String rol : ROLES) {
                Usuario u = new Usuario();
                u.setCorreo(rol.toLowerCase() + "@demo.com");
                u.setClave(protegerClave(claveDemo));
                u.setRol(rol);
                u.setNombre("Cuenta de prueba " + rol.toLowerCase());
                repository.save(u);
            }
            System.out.println("Cuentas de prueba creadas: " + ROLES.stream()
                    .map(r -> r.toLowerCase() + "@demo.com").toList());
        }
    }

    public boolean puedeGestionar(String rol) {
${politica?.explicito ? `        return com.example.demo.config.Permisos.ADMINISTRADORES.contains(rol) || com.example.demo.config.Permisos.POR_ROL.getOrDefault(rol, java.util.Map.of()).values().stream()
                .anyMatch(r -> !r.alcance().equals("ninguno") && r.acciones().stream().anyMatch(a -> !a.equals("ver")));` : `        return Arrays.stream(rolesGestores.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .anyMatch(s -> s.equalsIgnoreCase(rol));`}
    }

    public List<String> rolesQueGestionan() {
        return Arrays.stream(rolesGestores.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    public List<String> rolesQueSeRegistran() {
        return Arrays.stream(rolesRegistroPublico.split(",")).map(String::trim)
                .map(String::toUpperCase).filter(ROLES::contains).filter(r -> !puedeGestionar(r)).toList();
    }

    public Usuario registrar(String correo, String clave, String rol, String nombre, String referenciaId) {
        String elegido = rol == null ? "" : rol.trim().toUpperCase();
        var permitidos = rolesQueSeRegistran();
        if (!permitidos.contains(elegido)) throw new IllegalArgumentException(permitidos.isEmpty()
                ? "Las cuentas las crea quien administra. Pide que te den acceso."
                : "Al crear tu cuenta puedes elegir: " + permitidos);
${politica?.explicito ? `        if (referenciaId != null && !referenciaId.isBlank())
            throw new IllegalArgumentException("El registro público no puede reclamar un registro existente. Administración debe vincular tu cuenta.");
        return guardarCuenta(correo, clave, elegido, nombre, null, true);` : '        return crearCuenta(correo, clave, elegido, nombre, referenciaId);'}
    }

    public List<Usuario> cuentas() { return repository.findAll(); }

    public Usuario cambiarRol(Long id, String rol) {
        if (rol == null || !ROLES.contains(rol)) throw new IllegalArgumentException("Rol no válido.");
        Usuario usuario = repository.findById(id).orElseThrow(() -> new IllegalArgumentException("La cuenta no existe."));
${politica?.explicito ? '        if (!rol.equals(usuario.getRol())) { usuario.setReferenciaId(null); usuario.setVinculoVerificado(false); }' : ''}
        usuario.setRol(rol);
        return repository.save(usuario);
    }

    public Usuario crearCuenta(String correo, String clave, String rol, String nombre, String referenciaId) {
${politica?.explicito ? `        return guardarCuenta(correo, clave, rol, nombre, referenciaId, false);
    }

    public Usuario vincularCuenta(Long id, String referenciaId) {
        Usuario usuario = repository.findById(id).orElseThrow(() -> new IllegalArgumentException("La cuenta no existe."));
        usuario.setReferenciaId(vinculos.validar(usuario.getRol(), referenciaId, id, true));
        usuario.setVinculoVerificado(usuario.getReferenciaId() != null);
        return repository.save(usuario);
    }

    private Usuario guardarCuenta(String correo, String clave, String rol, String nombre, String referenciaId, boolean pendiente) {` : ''}
        String limpio = correo == null ? "" : correo.trim().toLowerCase();
        if (limpio.isEmpty() || !limpio.contains("@")) throw new IllegalArgumentException("Escribe un correo válido.");
        if (clave == null || clave.length() < 8) throw new IllegalArgumentException("La clave debe tener al menos 8 caracteres.");
        String rolLimpio = rol == null ? "" : rol.trim().toUpperCase();
        if (!ROLES.contains(rolLimpio)) throw new IllegalArgumentException("El rol debe ser uno de: " + ROLES);
        if (repository.existsByCorreoIgnoreCase(limpio)) throw new IllegalArgumentException("Ya existe una cuenta con ese correo.");

        Usuario usuario = new Usuario();
        usuario.setCorreo(limpio);
        usuario.setClave(protegerClave(clave));
        usuario.setRol(rolLimpio);
        usuario.setNombre(nombre);
        usuario.setReferenciaId(${politica?.explicito ? 'vinculos.validar(rolLimpio, referenciaId, null, pendiente)' : 'referenciaId'});
${politica?.explicito ? '        usuario.setVinculoVerificado(!pendiente && usuario.getReferenciaId() != null);' : ''}
        return repository.save(usuario);
    }

    public Optional<Usuario> autenticar(String correo, String clave) {
        if (correo == null || clave == null) return Optional.empty();
        return repository.findByCorreoIgnoreCase(correo.trim())
                .filter(u -> claveCoincide(clave, u.getClave()));
    }

    public Optional<Usuario> porCorreo(String correo) {
        return repository.findByCorreoIgnoreCase(correo == null ? "" : correo.trim());
    }

    // ---------------------------------------------------------------- token
    public String crearToken(Usuario usuario) {
        try {
            ObjectNode datos = json.createObjectNode();
            datos.put("correo", usuario.getCorreo());
            datos.put("rol", usuario.getRol());
            datos.put("nombre", usuario.getNombre());
            datos.put("vence", System.currentTimeMillis() + horasSesion * 3600_000L);
            String cuerpo = base64(json.writeValueAsBytes(datos));
            return cuerpo + "." + base64(firmar(cuerpo));
        } catch (Exception e) {
            throw new IllegalStateException("No se pudo crear la sesión");
        }
    }

    /** Devuelve los datos del token si la firma es válida y no venció. */
    public Optional<JsonNode> leerToken(String token) {
        try {
            if (token == null || !token.contains(".")) return Optional.empty();
            String[] partes = token.split("\\\\.");
            if (partes.length != 2) return Optional.empty();
            byte[] esperada = firmar(partes[0]);
            byte[] recibida = Base64.getUrlDecoder().decode(partes[1]);
            if (!java.security.MessageDigest.isEqual(esperada, recibida)) return Optional.empty();
            JsonNode datos = json.readTree(Base64.getUrlDecoder().decode(partes[0]));
            if (datos.path("vence").asLong(0) < System.currentTimeMillis()) return Optional.empty();
            return Optional.of(datos);
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private byte[] firmar(String texto) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secreto, "HmacSHA256"));
        return mac.doFinal(texto.getBytes(StandardCharsets.UTF_8));
    }

    private static String base64(byte[] datos) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(datos);
    }

    // ---------------------------------------------------------------- claves
    private String protegerClave(String clave) {
        byte[] sal = new byte[16];
        azar.nextBytes(sal);
        return "1:" + Base64.getEncoder().encodeToString(sal) + ":" + Base64.getEncoder().encodeToString(derivar(clave, sal));
    }

    private boolean claveCoincide(String clave, String guardada) {
        try {
            String[] partes = guardada.split(":");
            byte[] sal = Base64.getDecoder().decode(partes[1]);
            byte[] esperada = Base64.getDecoder().decode(partes[2]);
            return java.security.MessageDigest.isEqual(esperada, derivar(clave, sal));
        } catch (Exception e) {
            return false;
        }
    }

    private byte[] derivar(String clave, byte[] sal) {
        try {
            SecretKeyFactory fabrica = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            return fabrica.generateSecret(new PBEKeySpec(clave.toCharArray(), sal, 120_000, 256)).getEncoded();
        } catch (Exception e) {
            throw new IllegalStateException("No se pudo procesar la clave");
        }
    }
}
`;

export const controladorAuth = (politica = null) => `package com.example.demo.controllers;

import com.example.demo.entities.Usuario;
import com.example.demo.services.AuthService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Entrar al sistema.
 *
 * POST /api/auth/registro { correo, clave, rol, nombre, referenciaId }
 * POST /api/auth/login    { correo, clave }  -> { token, rol, nombre, puedeGestionar }
 * GET  /api/auth/yo       (con el token)
 * GET  /api/auth/roles    roles disponibles y cuáles pueden gestionar
 */
@RestController
@RequestMapping("/api/auth")
@CrossOrigin(origins = "*", maxAge = 3600)
public class AuthController {

    private final AuthService service;

    @Autowired
    public AuthController(AuthService service) {
        this.service = service;
    }

    @GetMapping("/roles")
    public ResponseEntity<Map<String, Object>> roles() {
        Map<String, Object> respuesta = new HashMap<>();
        respuesta.put("success", true);
        respuesta.put("data", Map.of("roles", AuthService.ROLES, "gestores", service.rolesQueGestionan(), "registroPublico", service.rolesQueSeRegistran()));
        return ResponseEntity.ok(respuesta);
    }

    @PostMapping("/registro")
    public ResponseEntity<Map<String, Object>> registro(@RequestBody Map<String, String> cuerpo) {
        Map<String, Object> respuesta = new HashMap<>();
        try {
            Usuario usuario = service.registrar(
                    cuerpo.get("correo"), cuerpo.get("clave"), cuerpo.get("rol"),
                    cuerpo.get("nombre"), cuerpo.get("referenciaId"));
            respuesta.put("success", true);
            respuesta.put("message", "Cuenta creada");
            respuesta.put("data", datosDeSesion(usuario));
            return ResponseEntity.status(HttpStatus.CREATED).body(respuesta);
        } catch (IllegalArgumentException e) {
            respuesta.put("success", false);
            respuesta.put("message", e.getMessage());
            return ResponseEntity.badRequest().body(respuesta);
        }
    }

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody Map<String, String> cuerpo) {
        Map<String, Object> respuesta = new HashMap<>();
        Optional<Usuario> usuario = service.autenticar(cuerpo.get("correo"), cuerpo.get("clave"));
        if (usuario.isEmpty()) {
            respuesta.put("success", false);
            respuesta.put("message", "El correo o la clave no son correctos.");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(respuesta);
        }
        respuesta.put("success", true);
        respuesta.put("message", "Sesión iniciada");
        respuesta.put("data", datosDeSesion(usuario.get()));
        return ResponseEntity.ok(respuesta);
    }

    @GetMapping("/yo")
    public ResponseEntity<Map<String, Object>> yo(@RequestHeader(value = "Authorization", required = false) String cabecera) {
        Map<String, Object> respuesta = new HashMap<>();
        String token = cabecera == null ? "" : cabecera.replaceFirst("(?i)^Bearer ", "").trim();
        var datos = service.leerToken(token);
        if (datos.isEmpty()) {
            respuesta.put("success", false);
            respuesta.put("message", "Tu sesión no está iniciada o expiró.");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(respuesta);
        }
        String correo = datos.get().path("correo").asText();
        Optional<Usuario> usuario = service.porCorreo(correo);
        if (usuario.isEmpty()) {
            respuesta.put("success", false);
            respuesta.put("message", "La cuenta ya no existe.");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(respuesta);
        }
        respuesta.put("success", true);
        respuesta.put("data", datosDeSesion(usuario.get()));
        return ResponseEntity.ok(respuesta);
    }

    private Map<String, Object> datosDeSesion(Usuario usuario) {
        Map<String, Object> datos = new HashMap<>();
        datos.put("token", service.crearToken(usuario));
        datos.put("correo", usuario.getCorreo());
        datos.put("rol", usuario.getRol());
        datos.put("nombre", usuario.getNombre());
        datos.put("referenciaId", ${politica?.explicito ? 'usuario.isVinculoVerificado() ? usuario.getReferenciaId() : null' : 'usuario.getReferenciaId()'});
        datos.put("puedeGestionar", service.puedeGestionar(usuario.getRol()));
        return datos;
    }
}
`;

export const filtroAuth = (politica = null) => `package com.example.demo.config;

import com.example.demo.services.AuthService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Exige haber iniciado sesión para usar la API y limita quién puede modificar datos:
 * cualquier rol puede consultar; crear, editar y borrar solo los roles de gestión.
 *
 * Quedan abiertos el inicio de sesión y el estado del asistente.
 */
@Component
public class AuthFiltro extends OncePerRequestFilter {

    private final AuthService auth;

    @Value("\${app.auth.activa:true}")
    private boolean activa;

    @Autowired
    public AuthFiltro(AuthService auth) {
        this.auth = auth;
    }

    /** Ruta decodificada, sin context-path ni parámetros de matriz de los segmentos. */
    private String rutaDe(HttpServletRequest peticion) {
        return peticion.getServletPath().replaceAll(";[^/]*", "");
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest peticion) {
        String ruta = rutaDe(peticion);
        return ${politica?.explicito ? 'false' : '!activa'}
                || "OPTIONS".equalsIgnoreCase(peticion.getMethod())
                || java.util.List.of("/api/auth/login", "/api/auth/registro", "/api/auth/roles").contains(ruta)
                || ruta.equals("/api/asistente/estado")
                || !ruta.startsWith("/api");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest peticion, HttpServletResponse respuesta, FilterChain cadena)
            throws ServletException, IOException {
        String cabecera = peticion.getHeader("Authorization");
        String token = cabecera == null ? "" : cabecera.replaceFirst("(?i)^Bearer ", "").trim();
        var datos = auth.leerToken(token);

        if (datos.isEmpty()) {
            responder(respuesta, HttpServletResponse.SC_UNAUTHORIZED,
                    "Inicia sesión para usar esta opción.");
            return;
        }

        var cuenta = auth.porCorreo(datos.get().path("correo").asText(""));
        if (cuenta.isEmpty()) {
            responder(respuesta, HttpServletResponse.SC_UNAUTHORIZED, "La cuenta ya no existe.");
            return;
        }
        String rol = cuenta.get().getRol();
        String metodo = peticion.getMethod();
        String ruta = rutaDe(peticion);
        boolean modifica = metodo.equals("POST") || metodo.equals("PUT")
                || metodo.equals("PATCH") || metodo.equals("DELETE");
${politica?.explicito ? `        String accion = switch (metodo) {
            case "GET", "HEAD" -> "ver"; case "POST" -> "crear";
            case "PUT", "PATCH" -> "editar"; case "DELETE" -> "borrar"; default -> "ninguna";
        };
        boolean permitido;
        if (ruta.equals("/api/auth/yo")) permitido = accion.equals("ver");
        else if (ruta.equals("/api/cuentas") || ruta.startsWith("/api/cuentas/") || ruta.startsWith("/api/asistente/"))
            permitido = Permisos.ADMINISTRADORES.contains(rol);
        else {
            String modulo = Permisos.modulo(ruta);
            permitido = modulo != null && Permisos.puede(rol, modulo, accion);
        }
        if (!permitido) {` : '        if ((modifica || ruta.equals("/api/cuentas") || ruta.startsWith("/api/cuentas/")) && !auth.puedeGestionar(rol)) {'}
            responder(respuesta, HttpServletResponse.SC_FORBIDDEN,
                    ${politica?.explicito ? '"Tu rol no permite esta operación en este módulo."' : '"Tu rol (" + rol + ") puede consultar, pero no modificar datos."'});
            return;
        }

        peticion.setAttribute("usuarioRol", rol);
        peticion.setAttribute("usuarioCorreo", datos.get().path("correo").asText(""));
${politica?.explicito ? '        peticion.setAttribute("usuarioReferenciaId", cuenta.get().isVinculoVerificado() ? cuenta.get().getReferenciaId() : null);' : ''}
        cadena.doFilter(peticion, respuesta);
    }

    private void responder(HttpServletResponse respuesta, int estado, String mensaje) throws IOException {
        respuesta.setStatus(estado);
        respuesta.setContentType("application/json;charset=UTF-8");
        respuesta.getWriter().write("{\\"success\\":false,\\"message\\":\\"" + mensaje + "\\"}");
    }
}
`;

export const propiedadesAuth = (roles) => `
# ===================================================================
# INICIO DE SESIÓN Y ROLES
# Los roles salen de las clases de personas del diagrama.
# Los "gestores" crean, editan y borran; el resto solo consulta.
# ===================================================================
app.auth.activa=true
app.auth.roles-gestores=${roles.filter((r) => r.gestor).map((r) => r.rol).join(',')}
app.auth.horas-sesion=12
# Firma de las sesiones: cámbiala por una frase larga propia (o usa la variable AUTH_SECRET)
app.auth.secreto=\${AUTH_SECRET:${randomBytes(48).toString('base64url')}}
# Cuentas de prueba al arrancar con la base vacía: ${roles.map((r) => `${r.rol.toLowerCase()}@demo.com`).join(', ')}
app.auth.roles-registro-publico=${roles.filter(r => !r.gestor).map(r => r.rol).join(',')}
app.auth.cuentas-demo=\${AUTH_DEMO:true}
app.auth.clave-demo=\${AUTH_DEMO_CLAVE:12345678}
`;

/** Administración protegida por AuthFiltro; nunca devuelve hashes ni tokens. */
export const controladorCuentas = (politica = null) => `package com.example.demo.controllers;

import com.example.demo.entities.Usuario;
import com.example.demo.services.AuthService;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import java.util.Map;
import java.util.HashMap;

@RestController
@RequestMapping("/api/cuentas")
public class CuentasController {
    private final AuthService service;
    public CuentasController(AuthService service) { this.service = service; }

    private Map<String, Object> publicar(Usuario cuenta) {
        Map<String, Object> datos = new HashMap<>();
        datos.put("id", cuenta.getId()); datos.put("correo", cuenta.getCorreo());
        datos.put("rol", cuenta.getRol()); datos.put("nombre", cuenta.getNombre());
${politica?.explicito ? '        datos.put("referenciaId", cuenta.getReferenciaId()); datos.put("vinculoVerificado", cuenta.isVinculoVerificado());' : ''}
        return datos;
    }

    @GetMapping
    public Map<String, Object> listar() {
        return Map.of("success", true, "data", service.cuentas().stream().map(this::publicar).toList());
    }

    @PostMapping
    public ResponseEntity<?> crear(@RequestBody Map<String, String> cuerpo) {
        try {
            var cuenta = service.crearCuenta(cuerpo.get("correo"), cuerpo.get("clave"), cuerpo.get("rol"), cuerpo.get("nombre"), cuerpo.get("referenciaId"));
            return ResponseEntity.status(201).body(Map.of("success", true, "data", publicar(cuenta)));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    @PutMapping("/{id}/rol")
    public ResponseEntity<?> cambiar(@PathVariable Long id, @RequestBody Map<String, String> cuerpo) {
        try {
            return ResponseEntity.ok(Map.of("success", true, "data", publicar(service.cambiarRol(id, cuerpo.get("rol")))));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }
${politica?.explicito ? `
    @PutMapping("/{id}/vinculo")
    public ResponseEntity<?> vincular(@PathVariable Long id, @RequestBody Map<String, String> cuerpo) {
        try {
            return ResponseEntity.ok(Map.of("success", true, "data", publicar(service.vincularCuenta(id, cuerpo.get("referenciaId")))));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }
` : ''}
}
`;
