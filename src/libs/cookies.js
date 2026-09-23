/**
 * Opciones de la cookie de sesión según cómo llegó la petición.
 * - HTTPS (directo o detrás del proxy de la plataforma; ver "trust proxy" en app.js):
 *   Secure + SameSite=None, que también sirve si el frontend está en otro dominio.
 * - HTTP (desarrollo o un servidor sin certificado): Lax, porque una cookie Secure
 *   no se guardaría y el login no funcionaría.
 */
export const opcionesCookie = (req, extra = {}) => {
  const segura = Boolean(req.secure);
  return {
    httpOnly: true,
    secure: segura,
    sameSite: segura ? 'None' : 'Lax',
    ...extra
  };
};
