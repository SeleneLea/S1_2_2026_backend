/**
 * De qué trata el sistema que se está exportando.
 *
 * El asistente del proyecto generado (backend y app móvil) necesita saber para qué sirve la
 * aplicación, no solo qué clases tiene: así responde "esta app administra los planes de
 * entrenamiento de un gimnasio" en vez de recitar una lista de tablas.
 *
 * Se arma con la IA en la nube a partir del diagrama; si no hay clave o falla, se usa un
 * resumen escrito a partir de las clases y sus relaciones, que siempre funciona.
 */
import { clienteGemini, hayClaveGemini } from './geminiRotacion.js';

const MODELO = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || 'gemini-2.5-flash')
    .split(',')[0].trim();

const legible = (texto) => String(texto || '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();

/** Resumen sin IA: nombre del tablero, clases principales y relaciones más marcadas. */
export const resumenSinIA = ({ titulo, entidades = [], relaciones = [] }) => {
    const nombres = entidades.map((e) => legible(e.name));
    if (!nombres.length) return `Sistema ${legible(titulo) || 'generado'} sin clases definidas.`;
    const principales = nombres.slice(0, 6).join(', ');
    const resto = nombres.length > 6 ? ` y ${nombres.length - 6} clases más` : '';
    const jerarquias = relaciones.filter((r) => r.type === 'inheritance').length;
    const partes = relaciones.filter((r) => r.type === 'composition' || r.type === 'aggregation').length;
    const detalles = [
        jerarquias ? `${jerarquias} jerarquía${jerarquias > 1 ? 's' : ''} de herencia` : null,
        partes ? `${partes} relación${partes > 1 ? 'es' : ''} de composición` : null,
    ].filter(Boolean).join(' y ');
    return `Sistema ${legible(titulo) || 'de gestión'}: administra ${principales}${resto}.`
        + (detalles ? ` El modelo incluye ${detalles}.` : '')
        + ' Permite registrar, consultar, modificar y eliminar cada uno de esos datos.';
};

const catalogoTexto = (entidades, relaciones) => {
    const nombre = (id) => (entidades.find((e) => e.id === id) || {}).name;
    const clases = entidades.map((e) => {
        const campos = (e.attributes || [])
            .filter((a) => !a.isPrimaryKey)
            .map((a) => a.name)
            .join(', ');
        return `- ${e.name}${campos ? `: ${campos}` : ''}`;
    });
    const enlaces = relaciones
        .map((r) => {
            const origen = nombre(r.source);
            const destino = nombre(r.target);
            if (!origen || !destino) return null;
            return `- ${origen} ${r.type === 'inheritance' ? 'hereda de' : 'se relaciona con'} ${destino}`;
        })
        .filter(Boolean);
    return [...clases, ...enlaces].join('\n');
};

/**
 * Devuelve un párrafo corto en español con el propósito del sistema.
 * Nunca lanza: si la IA no está disponible, devuelve el resumen sin IA.
 */
export const describirProyecto = async ({ titulo, descripcion, entidades = [], relaciones = [] }) => {
    const respaldo = resumenSinIA({ titulo, entidades, relaciones });
    if (!hayClaveGemini() || !entidades.length) return respaldo;

    const instruccion = `Eres analista de sistemas. A partir de este diagrama de clases, explica en
español y en tres frases como máximo de qué trata la aplicación y qué permite hacer a quien la usa.
No uses markdown, no enumeres las clases una por una y no inventes funciones que el modelo no soporta.

Nombre del proyecto: ${titulo || 'sin nombre'}
${descripcion ? `Notas del autor: ${descripcion}` : ''}

Clases y relaciones:
${catalogoTexto(entidades, relaciones)}`;

    try {
        const modelo = clienteGemini.getGenerativeModel({ model: MODELO });
        const resultado = await modelo.generateContent(instruccion);
        const texto = (await resultado.response).text().trim()
            .replace(/```[a-z]*|```/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        return texto.length > 20 ? texto : respaldo;
    } catch (error) {
        console.warn('No se pudo describir el proyecto con IA:', error?.message || error);
        return respaldo;
    }
};
