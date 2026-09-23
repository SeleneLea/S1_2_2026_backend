/**
 * Mensajes de error para el usuario. Los errores técnicos (Gemini, base de datos, red, código)
 * se traducen a un texto claro en español; el detalle original se sigue registrando en la
 * consola del servidor. Los mensajes que el propio código escribe para el usuario pasan tal cual.
 */

// Rastros de un error técnico que no debe verse en pantalla
const TECNICO = /\b(undefined|null|NaN|TypeError|ReferenceError|SyntaxError|RangeError|Exception|ECONN\w*|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|stack|fetch failed|Unexpected (token|end)|is not (a function|defined|valid JSON|iterable)|Cannot (read|set|find)|status code|GoogleGenerativeAI|googleapis|relation "|column "|violates|duplicate key|syntax error)\b|https?:\/\/|\[\d{3}[ \]]/i;
// Mensajes escritos en inglés (librerías, código antiguo)
const INGLES = /\b(the|is|are|was|not|failed|invalid|required|found|with|from|please|unauthorized|forbidden|missing|unable|could)\b/i;

export const esMensajeParaUsuario = (texto) =>
    typeof texto === 'string' && texto.trim().length > 0 && texto.length <= 300 && !TECNICO.test(texto) && !INGLES.test(texto);

const texto = (error) => (error && error.message) ? String(error.message) : String(error ?? '');

// Errores de la IA en la nube (Gemini) y de la conexión con ella
const REGLAS_IA = [
    [/429|Too Many Requests|quota|RESOURCE_EXHAUSTED|rate.?limit|cuota/i,
        'La IA en la nube alcanzó su límite de uso por ahora. Espera unos minutos o usa la IA local, que funciona sin internet.'],
    [/503|Service Unavailable|overload|UNAVAILABLE|high demand|saturad/i,
        'La IA en la nube está saturada en este momento. Intenta de nuevo en unos minutos o usa la IA local.'],
    [/API.?key|API_KEY|PERMISSION_DENIED|clave de Gemini/i,
        'La IA en la nube no está disponible porque el servidor no tiene una clave de Gemini válida. Puedes usar la IA local.'],
    [/model.{0,40}(not found|404|not supported)|modelo no encontrado/i,
        'El modelo de IA configurado en el servidor no está disponible. Puedes usar la IA local mientras se corrige.'],
    [/timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up/i,
        'No se pudo conectar con la IA en la nube (tardó demasiado o no hay conexión). Intenta de nuevo o usa la IA local.'],
    [/SAFETY|blocked|bloquead/i,
        'La IA no pudo responder a ese pedido. Intenta describirlo con otras palabras.'],
    [/JSON|Unexpected token|formato/i,
        'La IA respondió en un formato inesperado. Intenta de nuevo o describe tu pedido con otras palabras.'],
];

/** Mensaje para errores de funciones con IA en la nube. */
export const mensajeErrorIA = (error, porDefecto = 'No se pudo completar el pedido a la IA. Intenta de nuevo en unos segundos.') => {
    const t = texto(error);
    for (const [patron, mensaje] of REGLAS_IA) if (patron.test(t)) return mensaje;
    return esMensajeParaUsuario(t) ? t : porDefecto;
};

/** Mensaje para cualquier otro error: el texto propio si es para el usuario, si no el genérico. */
export const mensajeError = (error, porDefecto = 'Ocurrió un problema en el servidor. Intenta de nuevo en unos segundos.') => {
    const t = texto(error);
    if (/ECONNREFUSED|ENOTFOUND|Connection terminated|too many clients|the database system is/i.test(t)) {
        return 'No se pudo acceder a la base de datos en este momento. Intenta de nuevo en unos segundos.';
    }
    return esMensajeParaUsuario(t) ? t : porDefecto;
};
