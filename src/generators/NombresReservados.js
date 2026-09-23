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
/** Sustituye código Java, preservando comentarios y literales del catálogo del dominio. */
export const renombrarInfraestructura = (contenido, nombres) => contenido.replace(
    /"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|\b(?:UsuarioRepository|Usuario|AuthService|AuthController|AsistenteService|AsistenteController|CuentasController)\b/g,
    fragmento => nombres[fragmento] || fragmento
);
