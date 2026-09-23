/**
 * Asistente de IA del proyecto generado.
 *
 * Agrega al backend Spring Boot un endpoint `/api/asistente` que responde preguntas sobre el
 * sistema (qué datos pide cada formulario, cómo registrar algo, qué relaciones existen). Habla
 * con un servicio compatible con la API de OpenAI —DeepSeek por defecto— y la clave nunca va en
 * el código: sale de la variable de entorno DEEPSEEK_API_KEY. Sin clave, el endpoint responde
 * que no está configurado y la app móvil sigue funcionando con su asistente sin internet.
 */

const tipoLegible = (attr) => {
    const t = String(attr.type || 'String');
    return {
        String: 'texto', Integer: 'número entero', Long: 'número entero', Double: 'número decimal',
        Float: 'número decimal', BigDecimal: 'número decimal', Boolean: 'sí/no',
        LocalDate: 'fecha', LocalDateTime: 'fecha y hora', LocalTime: 'hora', UUID: 'texto'
    }[t] || 'texto';
};

/** Catálogo del dominio en texto plano: es lo que el modelo necesita para responder bien. */
export const catalogoDominio = (entidades, relaciones = []) => {
    const lineas = [];
    entidades.forEach((e) => {
        const campos = (e.attributes || [])
            .filter((a) => !a.isPrimaryKey)
            .map((a) => `${a.name} (${tipoLegible(a)}${a.isForeignKey ? `, referencia a ${a.referencedEntity}` : ''})`);
        lineas.push(`- ${e.name}: ${campos.length ? campos.join(', ') : 'sin campos propios'}`);
    });
    const nombre = (id) => (entidades.find((e) => e.id === id) || {}).name;
    relaciones.forEach((r) => {
        const origen = nombre(r.source);
        const destino = nombre(r.target);
        if (!origen || !destino) return;
        const texto = {
            inheritance: `${origen} es un tipo de ${destino}`,
            composition: `${destino} forma parte de ${origen}`,
            aggregation: `${origen} agrupa a ${destino}`,
            'many-to-many-direct': `${origen} y ${destino} se relacionan de muchos a muchos`
        }[r.type] || `${origen} se relaciona con ${destino}`;
        lineas.push(`- ${texto}`);
    });
    return lineas.join('\n');
};

const escaparJava = (texto) => String(texto).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export const servicioAsistente = (nombreApp, entidades, relaciones, proposito = '') => `package com.example.demo.services;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Asistente del sistema. Responde preguntas sobre ${nombreApp}.
 *
 * Usa los servicios de IA en el orden configurado (por defecto Gemini y luego DeepSeek): si el
 * primero se queda sin cuota, falla o tarda demasiado, prueba con el siguiente. Las claves nunca
 * van en el código: salen de las variables de entorno GEMINI_API_KEY y DEEPSEEK_API_KEY.
 */
@Service
public class AsistenteService {

    /** Lo que el sistema guarda: el modelo necesita esto para responder con datos reales. */
    private static final String CATALOGO = """
${catalogoDominio(entidades, relaciones)}
""";

    /** De qué trata el sistema, escrito al exportar el proyecto desde el diagrama. */
    private static final String PROPOSITO = """
${escaparJava(proposito || 'Sistema generado a partir de un diagrama de clases.')}
""";

    private static final String INSTRUCCIONES = """
Eres el asistente de la aplicación ${escaparJava(nombreApp)}.
Respondes en español, en dos o tres frases, sin markdown y sin inventar datos.
Si te preguntan por algo que la aplicación no guarda, dilo con claridad.
De qué trata la aplicación:
""" + PROPOSITO + """

Estas son las clases del sistema y sus campos:
""";

    /** Orden en que se prueban los servicios de IA. */
    @Value("\${asistente.orden:gemini,deepseek}")
    private String orden;

    @Value("\${asistente.gemini.api-key:}")
    private String claveGemini;

    @Value("\${asistente.gemini.modelo:gemini-2.5-flash}")
    private String modeloGemini;

    @Value("\${asistente.deepseek.api-key:}")
    private String claveDeepSeek;

    @Value("\${asistente.deepseek.modelo:deepseek-chat}")
    private String modeloDeepSeek;

    @Value("\${asistente.deepseek.api-url:https://api.deepseek.com/chat/completions}")
    private String urlDeepSeek;

    private final ObjectMapper json = new ObjectMapper();
    // HTTP/1.1: con HTTP/2 las llamadas a Gemini se quedaban colgadas hasta agotar el tiempo
    private final HttpClient cliente = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    /** Proveedores que tienen clave, en el orden configurado. */
    private List<String> disponibles() {
        List<String> lista = new ArrayList<>();
        for (String nombre : orden.split(",")) {
            String p = nombre.trim().toLowerCase();
            if (p.equals("gemini") && claveGemini != null && !claveGemini.isBlank()) lista.add("gemini");
            if (p.equals("deepseek") && claveDeepSeek != null && !claveDeepSeek.isBlank()) lista.add("deepseek");
        }
        return lista;
    }

    public boolean estaConfigurado() {
        return !disponibles().isEmpty();
    }

    /** Nombre del servicio que respondió, para mostrarlo en la app. */
    public static class Respuesta {
        public final String texto;
        public final String proveedor;

        public Respuesta(String texto, String proveedor) {
            this.texto = texto;
            this.proveedor = proveedor;
        }
    }

    /**
     * Pregunta al primer servicio con clave; si se queda sin cuota o falla, prueba el siguiente.
     */
    public Respuesta responder(String pregunta) {
        List<String> proveedores = disponibles();
        if (proveedores.isEmpty()) {
            throw new IllegalStateException("No hay ningún servicio de IA configurado.");
        }
        IllegalStateException ultimoError = null;
        for (String proveedor : proveedores) {
            try {
                String texto = proveedor.equals("gemini")
                        ? preguntarGemini(pregunta)
                        : preguntarDeepSeek(pregunta);
                if (texto != null && !texto.isBlank()) {
                    return new Respuesta(texto.trim(), proveedor);
                }
                ultimoError = new IllegalStateException("El servicio " + proveedor + " respondió vacío.");
            } catch (Exception e) {
                ultimoError = new IllegalStateException(
                        "El servicio " + proveedor + " no respondió: " + e.getMessage());
                System.out.println("Asistente: " + proveedor + " falló (" + e.getMessage() + "); se prueba el siguiente");
            }
        }
        throw ultimoError;
    }

    private String preguntarGemini(String pregunta) throws Exception {
        String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                + URLEncoder.encode(modeloGemini, StandardCharsets.UTF_8) + ":generateContent";

        ObjectNode sistema = json.createObjectNode();
        sistema.putArray("parts").addObject().put("text", INSTRUCCIONES + CATALOGO);

        ObjectNode contenido = json.createObjectNode();
        contenido.put("role", "user");
        contenido.putArray("parts").addObject().put("text", pregunta);

        ArrayNode contenidos = json.createArrayNode();
        contenidos.add(contenido);

        ObjectNode ajustes = json.createObjectNode();
        ajustes.put("temperature", 0.2);
        ajustes.put("maxOutputTokens", 400);

        ObjectNode cuerpo = json.createObjectNode();
        cuerpo.set("system_instruction", sistema);
        cuerpo.set("contents", contenidos);
        cuerpo.set("generationConfig", ajustes);

        HttpRequest peticion = HttpRequest.newBuilder(URI.create(url))
                .header("Content-Type", "application/json")
                .header("x-goog-api-key", claveGemini)
                .timeout(Duration.ofSeconds(60))
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(cuerpo)))
                .build();

        HttpResponse<String> respuesta = cliente.send(peticion, HttpResponse.BodyHandlers.ofString());
        revisarEstado(respuesta.statusCode(), "Gemini");
        JsonNode datos = json.readTree(respuesta.body());
        return datos.path("candidates").path(0).path("content").path("parts").path(0).path("text").asText("");
    }

    private String preguntarDeepSeek(String pregunta) throws Exception {
        ObjectNode sistema = json.createObjectNode();
        sistema.put("role", "system");
        sistema.put("content", INSTRUCCIONES + CATALOGO);

        ObjectNode usuario = json.createObjectNode();
        usuario.put("role", "user");
        usuario.put("content", pregunta);

        ArrayNode mensajes = json.createArrayNode();
        mensajes.add(sistema);
        mensajes.add(usuario);

        ObjectNode cuerpo = json.createObjectNode();
        cuerpo.put("model", modeloDeepSeek);
        cuerpo.put("temperature", 0.2);
        cuerpo.put("max_tokens", 400);
        cuerpo.set("messages", mensajes);

        HttpRequest peticion = HttpRequest.newBuilder(URI.create(urlDeepSeek))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + claveDeepSeek)
                .timeout(Duration.ofSeconds(60))
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(cuerpo)))
                .build();

        HttpResponse<String> respuesta = cliente.send(peticion, HttpResponse.BodyHandlers.ofString());
        revisarEstado(respuesta.statusCode(), "DeepSeek");
        JsonNode datos = json.readTree(respuesta.body());
        return datos.path("choices").path(0).path("message").path("content").asText("");
    }

    /** Traduce los códigos de error a algo que se entienda en el log y en la app. */
    private void revisarEstado(int estado, String servicio) {
        if (estado == 401 || estado == 403) {
            throw new IllegalStateException("la clave de " + servicio + " no es válida");
        }
        if (estado == 429) {
            throw new IllegalStateException(servicio + " se quedó sin cuota");
        }
        if (estado >= 500) {
            throw new IllegalStateException(servicio + " tuvo un problema en su servidor");
        }
        if (estado >= 400) {
            throw new IllegalStateException(servicio + " rechazó la consulta (" + estado + ")");
        }
    }
}
`;

export const controladorAsistente = (nombreApp) => `package com.example.demo.controllers;

import com.example.demo.services.AsistenteService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * Asistente de ${nombreApp}: responde preguntas sobre el sistema.
 *
 * POST /api/asistente  { "pregunta": "¿qué datos pide un cliente?" }
 * GET  /api/asistente/estado  -> si hay clave configurada
 */
@RestController
@RequestMapping("/api/asistente")
@CrossOrigin(origins = "*", maxAge = 3600)
public class AsistenteController {

    private final AsistenteService service;

    @Autowired
    public AsistenteController(AsistenteService service) {
        this.service = service;
    }

    @GetMapping("/estado")
    public ResponseEntity<Map<String, Object>> estado() {
        Map<String, Object> respuesta = new HashMap<>();
        respuesta.put("success", true);
        respuesta.put("configurado", service.estaConfigurado());
        respuesta.put("message", service.estaConfigurado()
                ? "El asistente está disponible"
                : "El asistente por internet no está configurado en el servidor");
        return ResponseEntity.ok(respuesta);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> preguntar(@RequestBody Map<String, String> cuerpo) {
        String pregunta = cuerpo == null ? null : cuerpo.get("pregunta");
        Map<String, Object> respuesta = new HashMap<>();

        if (pregunta == null || pregunta.isBlank()) {
            respuesta.put("success", false);
            respuesta.put("message", "Escribe una pregunta para el asistente.");
            return ResponseEntity.badRequest().body(respuesta);
        }
        if (!service.estaConfigurado()) {
            respuesta.put("success", false);
            respuesta.put("message", "El asistente por internet no está configurado: falta GEMINI_API_KEY o DEEPSEEK_API_KEY en el servidor.");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(respuesta);
        }
        try {
            AsistenteService.Respuesta salida = service.responder(pregunta);
            respuesta.put("success", true);
            respuesta.put("data", Map.of("respuesta", salida.texto, "proveedor", salida.proveedor));
            return ResponseEntity.ok(respuesta);
        } catch (IllegalStateException e) {
            respuesta.put("success", false);
            respuesta.put("message", e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(respuesta);
        } catch (Exception e) {
            respuesta.put("success", false);
            respuesta.put("message", "No se pudo consultar al asistente. Revisa la conexión del servidor.");
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(respuesta);
        }
    }
}
`;

/** Bloque que se agrega a application.properties. */
export const propiedadesAsistente = () => `
# ===================================================================
# ASISTENTE DE IA (opcional)
# Se prueban en orden: primero Gemini y, si se queda sin cuota o falla, DeepSeek.
# Las claves NO se escriben aquí: se toman de las variables de entorno.
#   Windows:  setx GEMINI_API_KEY "tu-clave"     setx DEEPSEEK_API_KEY "tu-clave"
#   Linux:    export GEMINI_API_KEY="tu-clave"   export DEEPSEEK_API_KEY="tu-clave"
# Sin ninguna clave, la app móvil sigue respondiendo con su asistente sin internet.
# ===================================================================
asistente.orden=gemini,deepseek
asistente.gemini.modelo=gemini-2.5-flash
asistente.gemini.api-key=\${GEMINI_API_KEY:}
asistente.deepseek.api-url=https://api.deepseek.com/chat/completions
asistente.deepseek.modelo=deepseek-chat
asistente.deepseek.api-key=\${DEEPSEEK_API_KEY:}
`;
