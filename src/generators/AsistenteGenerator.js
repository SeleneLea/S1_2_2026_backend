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
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Asistente del sistema. Responde preguntas sobre ${nombreApp} usando un servicio de IA
 * compatible con la API de OpenAI (DeepSeek por defecto).
 *
 * La clave se define fuera del código, en la variable de entorno DEEPSEEK_API_KEY.
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

    @Value("\${asistente.api-url:https://api.deepseek.com/chat/completions}")
    private String apiUrl;

    @Value("\${asistente.api-key:}")
    private String apiKey;

    @Value("\${asistente.modelo:deepseek-chat}")
    private String modelo;

    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient cliente = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    /** ¿Hay clave configurada? Sin ella la app móvil usa su asistente sin internet. */
    public boolean estaConfigurado() {
        return apiKey != null && !apiKey.isBlank();
    }

    public String responder(String pregunta) throws Exception {
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
        cuerpo.put("model", modelo);
        cuerpo.put("temperature", 0.2);
        cuerpo.put("max_tokens", 400);
        cuerpo.set("messages", mensajes);

        HttpRequest peticion = HttpRequest.newBuilder(URI.create(apiUrl))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .timeout(Duration.ofSeconds(60))
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(cuerpo)))
                .build();

        HttpResponse<String> respuesta = cliente.send(peticion, HttpResponse.BodyHandlers.ofString());
        if (respuesta.statusCode() == 401 || respuesta.statusCode() == 403) {
            throw new IllegalStateException("La clave del asistente no es válida.");
        }
        if (respuesta.statusCode() == 429) {
            throw new IllegalStateException("El asistente alcanzó su límite de uso. Intenta en unos minutos.");
        }
        if (respuesta.statusCode() >= 400) {
            throw new IllegalStateException("El servicio de IA no pudo responder.");
        }
        JsonNode datos = json.readTree(respuesta.body());
        String texto = datos.path("choices").path(0).path("message").path("content").asText("");
        if (texto.isBlank()) {
            throw new IllegalStateException("El servicio de IA devolvió una respuesta vacía.");
        }
        return texto.trim();
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
            respuesta.put("message", "El asistente por internet no está configurado: falta la variable DEEPSEEK_API_KEY en el servidor.");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(respuesta);
        }
        try {
            respuesta.put("success", true);
            respuesta.put("data", Map.of("respuesta", service.responder(pregunta)));
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
# La clave NO se escribe aquí: se toma de la variable de entorno DEEPSEEK_API_KEY.
#   Windows:  setx DEEPSEEK_API_KEY "tu-clave"
#   Linux:    export DEEPSEEK_API_KEY="tu-clave"
# Sin clave, la app móvil sigue respondiendo con su asistente sin internet.
# ===================================================================
asistente.api-url=https://api.deepseek.com/chat/completions
asistente.modelo=deepseek-chat
asistente.api-key=\${DEEPSEEK_API_KEY:}
`;
