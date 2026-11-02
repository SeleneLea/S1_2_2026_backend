/** Nombres compartidos por las exportaciones; nunca se renombra la clase del diagrama. */
const normalizar = texto => String(texto).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export const mismoNombre = (a, b) => normalizar(a) === normalizar(b);
export const nombreLibre = (base, entidades = []) => {
    const ocupado = nombre => entidades.some(e => mismoNombre(e.name, nombre));
    for (const sufijo of ['', 'Acceso', 'Interno', 'Generado']) {
        if (!ocupado(base + sufijo)) return base + sufijo;
    }
    let numero = 2;
    while (ocupado(base + numero)) numero++;
    return base + numero;
};
// Igual que las columnas y tablas de EntityGenerator, incluidos los acrónimos.
export const aSnake = nombre => String(nombre).replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
export const rutaEntidad = nombre => {
    const ruta = String(nombre).replace(/([a-z])([A-Z])/g, '$1-$2').normalize('NFD')
        .replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return ['auth', 'asistente', 'cuentas'].includes(ruta) ? `entidades/${ruta}` : ruta;
};
const RUTA_PROPIA = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const limpiarRuta = ruta => typeof ruta === 'string' ? ruta.trim().replace(/^\/+|\/+$/g, '') : '';
// La de la cuenta y el asistente las usa la infraestructura del proyecto generado
const rutaPropiaValida = ruta => RUTA_PROPIA.test(ruta) && !['auth', 'asistente', 'cuentas'].includes(ruta.split('/')[0].toLowerCase());

/**
 * Ruta de la API de una entidad (lo que va después de "/api/"). Si el diagrama salió de un backend
 * existente (código importado), es la de su controlador (rutaApi); si no, la que arma la herramienta.
 */
export const rutaDe = entidad => {
    const propia = limpiarRuta(entidad?.rutaApi);
    return propia && rutaPropiaValida(propia) ? propia : rutaEntidad(entidad?.name);
};

/**
 * Deja en cada entidad solo una rutaApi usable: con formato de ruta, fuera de la infraestructura y
 * sin pisar la de otra entidad (p. ej. una clase copiada con la misma ruta). Así el backend y la app
 * generados desde el mismo diagrama usan las mismas rutas.
 */
export const ajustarRutasPropias = (entidades, otras = []) => {
    const conPropia = entidades.filter(e => rutaPropiaValida(limpiarRuta(e.rutaApi)));
    const ocupadas = new Set([...entidades.filter(e => !conPropia.includes(e)), ...otras].map(e => rutaEntidad(e.name).toLowerCase()));
    for (const entidad of entidades) {
        if (!conPropia.includes(entidad)) { delete entidad.rutaApi; continue; }
        const ruta = limpiarRuta(entidad.rutaApi);
        if (ocupadas.has(ruta.toLowerCase())) { delete entidad.rutaApi; continue; }
        entidad.rutaApi = ruta;
        ocupadas.add(ruta.toLowerCase());
    }
    return entidades;
};

/** Sustituye código Java, preservando comentarios y literales del catálogo del dominio. */
export const renombrarInfraestructura = (contenido, nombres) => contenido.replace(
    /"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|\b(?:UsuarioRepository|Usuario|AuthService|AuthController|AsistenteService|AsistenteController|CuentasController)\b/g,
    fragmento => nombres[fragmento] || fragmento
);
