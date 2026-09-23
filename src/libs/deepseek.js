/**
 * DeepSeek como respaldo de Gemini para los pedidos de solo texto.
 *
 * Cuando todas las claves de Gemini se quedan sin cuota, fallan o están saturadas, la app
 * sigue funcionando con este servicio, que usa la misma forma de la API de OpenAI. La clave
 * nunca va en el código: sale de DEEPSEEK_API_KEY.
 *
 * Los pedidos con imagen o audio no pasan por aquí: DeepSeek no los admite.
 */

const URL_DEEPSEEK = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const MODELO_DEEPSEEK = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

export const hayClaveDeepSeek = () => Boolean((process.env.DEEPSEEK_API_KEY || '').trim());

/**
 * Genera texto con DeepSeek. Lanza si no hay clave o si el servicio responde con error,
 * con un mensaje que explique qué pasó.
 */
export const generarConDeepSeek = async (prompt, { temperatura = 0.2, maxTokens = 2048, señal } = {}) => {
    const clave = (process.env.DEEPSEEK_API_KEY || '').trim();
    if (!clave) throw new Error('No hay clave de DeepSeek configurada (DEEPSEEK_API_KEY)');

    const respuesta = await fetch(URL_DEEPSEEK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` },
        signal: señal,
        body: JSON.stringify({
            model: MODELO_DEEPSEEK,
            messages: [{ role: 'user', content: prompt }],
            temperature: temperatura,
            max_tokens: maxTokens,
        }),
    });

    if (respuesta.status === 401 || respuesta.status === 403) throw new Error('La clave de DeepSeek no es válida');
    if (respuesta.status === 429) throw new Error('DeepSeek se quedó sin cuota');
    if (!respuesta.ok) throw new Error(`DeepSeek respondió ${respuesta.status}`);

    const datos = await respuesta.json();
    const texto = datos?.choices?.[0]?.message?.content || '';
    if (!texto.trim()) throw new Error('DeepSeek devolvió una respuesta vacía');
    return texto;
};

/**
 * Ejecuta el pedido con Gemini y, si falla, lo reintenta con DeepSeek.
 * @param {() => Promise<string>} conGemini  cómo pedirlo a Gemini
 * @param {string} prompt                    el mismo pedido, en texto plano, para el respaldo
 */
export const conRespaldoDeepSeek = async (conGemini, prompt, opciones = {}) => {
    try {
        return { texto: await conGemini(), proveedor: 'gemini' };
    } catch (error) {
        if (!hayClaveDeepSeek()) throw error;
        console.warn('Gemini falló (', error?.message || error, '): se prueba con DeepSeek');
        const texto = await generarConDeepSeek(prompt, opciones);
        return { texto, proveedor: 'deepseek' };
    }
};
