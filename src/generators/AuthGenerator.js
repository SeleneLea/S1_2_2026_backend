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
    // Si ninguno gestiona, el primero lo hace: si no, nadie podría cargar datos
    if (!roles.some((r) => r.gestor)) roles[0].gestor = true;
    return roles;
};

const lista = (valores) => valores.map((v) => `"${v}"`).join(', ');

export const entidadUsuario = () => `package com.example.demo.entities;

import jakarta.persistence.*;

/**
 * Cuenta para entrar al sistema. El rol sale de las clases de personas del diagrama y decide
 * qué puede hacer: todos consultan, solo los roles de gestión crean, editan y borran.
 */
@Entity
@Table(name = "usuario", uniqueConstraints = @UniqueConstraint(columnNames = "correo"))
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

export const servicioAuth = (roles) => `package com.example.demo.services;

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
    private final ObjectMapper json = new ObjectMapper();
    private final SecureRandom azar = new SecureRandom();

    /** Roles que pueden crear, editar y borrar. El resto solo consulta. */
    @Value("\${app.auth.roles-gestores:${roles.filter((r) => r.gestor).map((r) => r.rol).join(',')}}")
    private String rolesGestores;

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
        String base = secretoConfigurado == null || secretoConfigurado.isBlank()
                ? "clave-de-firma-por-defecto-cambiala-en-produccion"
                : secretoConfigurado;
        secreto = base.getBytes(StandardCharsets.UTF_8);
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
                    .map(r -> r.toLowerCase() + "@demo.com").toList() + " con la clave " + claveDemo);
        }
    }

    public boolean puedeGestionar(String rol) {
        return Arrays.stream(rolesGestores.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .anyMatch(s -> s.equalsIgnoreCase(rol));
    }

    public List<String> rolesQueGestionan() {
        return Arrays.stream(rolesGestores.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    public Usuario registrar(String correo, String clave, String rol, String nombre, String referenciaId) {
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
        usuario.setReferenciaId(referenciaId);
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

export const controladorAuth = () => `package com.example.demo.controllers;

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
        respuesta.put("data", Map.of("roles", AuthService.ROLES, "gestores", service.rolesQueGestionan()));
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
        datos.put("referenciaId", usuario.getReferenciaId());
        datos.put("puedeGestionar", service.puedeGestionar(usuario.getRol()));
        return datos;
    }
}
`;

export const filtroAuth = () => `package com.example.demo.config;

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

    @Override
    protected boolean shouldNotFilter(HttpServletRequest peticion) {
        String ruta = peticion.getRequestURI();
        return !activa
                || "OPTIONS".equalsIgnoreCase(peticion.getMethod())
                || ruta.startsWith("/api/auth")
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

        String rol = datos.get().path("rol").asText("");
        String metodo = peticion.getMethod();
        boolean modifica = metodo.equals("POST") || metodo.equals("PUT")
                || metodo.equals("PATCH") || metodo.equals("DELETE");
        if (modifica && !auth.puedeGestionar(rol)) {
            responder(respuesta, HttpServletResponse.SC_FORBIDDEN,
                    "Tu rol (" + rol + ") puede consultar, pero no modificar datos.");
            return;
        }

        peticion.setAttribute("usuarioRol", rol);
        peticion.setAttribute("usuarioCorreo", datos.get().path("correo").asText(""));
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
app.auth.secreto=\${AUTH_SECRET:cambia-esta-frase-por-una-larga-y-secreta}
# Cuentas de prueba al arrancar con la base vacía: ${roles.map((r) => `${r.rol.toLowerCase()}@demo.com`).join(', ')}
app.auth.cuentas-demo=true
app.auth.clave-demo=12345678
`;
