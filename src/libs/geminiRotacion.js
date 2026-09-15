/**
 * Rotación de API keys de Gemini.
 *
 * Con varias cuentas de Google AI Studio se multiplica la cuota gratuita: si una key
 * responde 429 (cuota agotada) o 403 (sin permiso o key inválida) se pasa a la
 * siguiente. Los errores transitorios (500/502/503/504 o de red) se reintentan con la
 * misma key. Es el mismo criterio que usa el ia_service del proyecto de trámites.
 *
 * Configuración en backend/.env (no commitear):
 *   GEMINI_API_KEYS=key1,key2,key3   separadas por coma
 *   GEMINI_API_KEY=key               se suma al grupo (compatibilidad)
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

const MARCADOR = 'your_gemini_api_key_here';
// 429: la cuota por minuto se recupera sola; 403: no insistir con esa key por un rato
const ENFRIAMIENTO_CUOTA_MS = 60 * 1000;
const ENFRIAMIENTO_RECHAZADA_MS = 10 * 60 * 1000;
// Proyectos nuevos no pueden usar modelos retirados: esa key queda fuera solo para ese modelo
const ENFRIAMIENTO_MODELO_MS = 6 * 60 * 60 * 1000;

/** Keys configuradas, sin repetir y sin el valor de ejemplo. */
export const clavesGemini = (env = process.env) => [...new Set(
  [...String(env.GEMINI_API_KEYS || '').split(','), String(env.GEMINI_API_KEY || '')]
    .map((k) => k.trim())
    .filter((k) => k && k !== MARCADOR)
)];

export const hayClaveGemini = () => clavesGemini().length > 0;

const estadoHttp = (error) => {
  const status = Number(error?.status ?? error?.response?.status);
  if (Number.isFinite(status) && status > 0) return status;
  // El SDK también lo pone en el mensaje: "... [429 Too Many Requests] ..."
  const m = /\[(\d{3})[\s\]]/.exec(String(error?.message || ''));
  return m ? Number(m[1]) : null;
};

/** 'cuota' | 'rechazada' | 'modelo' | 'transitorio' | 'otro' */
export const clasificarError = (error) => {
  const estado = estadoHttp(error);
  const texto = String(error?.message || '');
  if (estado === 429 || /RESOURCE_EXHAUSTED|quota/i.test(texto)) return 'cuota';
  if (estado === 403 || /PERMISSION_DENIED|API_KEY_INVALID|API key not valid|API key expired/i.test(texto)) return 'rechazada';
  // 404 que depende de la key, no del pedido: "This model ... is no longer available to new users"
  if (/(no longer|not) available to new users/i.test(texto)) return 'modelo';
  if ([500, 502, 503, 504].includes(estado) || /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|overloaded/i.test(texto)) return 'transitorio';
  return 'otro';
};

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mascara = (clave) => `…${String(clave).slice(-4)}`;

/**
 * Cliente con la misma forma que GoogleGenerativeAI (getGenerativeModel().generateContent())
 * que rota las keys por dentro. `fabrica` permite probarlo sin llamar a Google.
 */
export const crearClienteGemini = ({
  claves = clavesGemini,
  fabrica = (clave) => new GoogleGenerativeAI(clave),
  reintentosTransitorios = 2,
  esperaBaseMs = 2000,
  registro = console,
} = {}) => {
  const bloqueadaHasta = new Map();
  let ultimaQueFunciono = null;
  const lista = () => (typeof claves === 'function' ? claves() : claves);

  const ejecutar = async (llamar, modelo = '') => {
    const todas = lista();
    if (!todas.length) {
      throw new Error('No hay API keys de Gemini configuradas (GEMINI_API_KEYS o GEMINI_API_KEY)');
    }
    // Se empieza por la última key que funcionó y se saltan las que están en enfriamiento
    const inicio = Math.max(0, todas.indexOf(ultimaQueFunciono));
    const orden = todas.map((_, i) => todas[(inicio + i) % todas.length]);
    const ahora = Date.now();
    const libre = (k) => (bloqueadaHasta.get(k) || 0) <= ahora && (bloqueadaHasta.get(`${k}|${modelo}`) || 0) <= ahora;
    const disponibles = orden.filter(libre);
    const aProbar = disponibles.length ? disponibles : orden; // todas enfriándose: se intenta igual

    let ultimoError;
    for (const clave of aProbar) {
      for (let intento = 0; ; intento++) {
        try {
          const resultado = await llamar(fabrica(clave));
          ultimaQueFunciono = clave;
          return resultado;
        } catch (error) {
          ultimoError = error;
          const tipo = clasificarError(error);
          if (tipo === 'transitorio' && intento < reintentosTransitorios) {
            await esperar(esperaBaseMs * (intento + 1));
            continue;
          }
          if (tipo === 'cuota' || tipo === 'rechazada') {
            bloqueadaHasta.set(clave, Date.now() + (tipo === 'cuota' ? ENFRIAMIENTO_CUOTA_MS : ENFRIAMIENTO_RECHAZADA_MS));
            registro?.warn?.(`Gemini: key ${mascara(clave)} ${tipo === 'cuota' ? 'sin cuota' : 'rechazada'}; se prueba la siguiente`);
            break;
          }
          if (tipo === 'modelo') {
            bloqueadaHasta.set(`${clave}|${modelo}`, Date.now() + ENFRIAMIENTO_MODELO_MS);
            registro?.warn?.(`Gemini: key ${mascara(clave)} no puede usar ${modelo || 'este modelo'}; se prueba la siguiente`);
            break;
          }
          if (tipo === 'transitorio') break; // agotó los reintentos: otra key
          // Error del pedido (modelo inexistente, contenido inválido...): rotar no ayuda
          throw error;
        }
      }
    }
    throw ultimoError;
  };

  return {
    getGenerativeModel: (parametrosModelo, opcionesPeticion) => {
      const modelo = String(parametrosModelo?.model || '');
      return {
        generateContent: (...args) => ejecutar((cliente) =>
          cliente.getGenerativeModel(parametrosModelo, opcionesPeticion).generateContent(...args), modelo),
        generateContentStream: (...args) => ejecutar((cliente) =>
          cliente.getGenerativeModel(parametrosModelo, opcionesPeticion).generateContentStream(...args), modelo),
        countTokens: (...args) => ejecutar((cliente) =>
          cliente.getGenerativeModel(parametrosModelo, opcionesPeticion).countTokens(...args), modelo),
      };
    },
    /** Cuántas keys hay y cuántas no están en enfriamiento (sin exponerlas). */
    estado: () => {
      const todas = lista();
      const ahora = Date.now();
      return { keys: todas.length, disponibles: todas.filter((k) => (bloqueadaHasta.get(k) || 0) <= ahora).length };
    },
  };
};

// Cliente compartido por todos los controladores de IA
export const clienteGemini = crearClienteGemini();
