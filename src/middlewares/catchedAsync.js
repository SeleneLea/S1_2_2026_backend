import { esMensajeParaUsuario, mensajeError } from '../libs/mensajesError.js';

export const catchedAsync = (fn) => {
  return (req, res, next) => {
      fn(req, res, next).catch(next);
  };
};
// response.js
// En los errores (status >= 400) el motivo también va arriba, en "message": ahí lo busca el frontend.
export const response = (res, statusCode, data) => {
  const esError = statusCode >= 400;
  const message = esError
      ? (typeof data?.message === 'string' ? data.message : (typeof data?.error === 'string' ? data.error : undefined))
      : undefined;
  res.status(statusCode).json({
      error: esError,
      ...(message ? { message } : {}),
      data
  });
};
// errorHandler.js
// El detalle técnico queda en el log; al usuario le llega un mensaje claro en español.
const errorHandler = (err, req, res, next) => {
  console.error(err.stack || err);
  let statusCode = err.statusCode || err.status || 500;
  let message;
  if (err.type === 'entity.parse.failed') {
      message = 'Los datos enviados no tienen un formato válido.';
  } else if (err.type === 'entity.too.large') {
      message = 'Lo que intentas enviar es demasiado grande. Prueba con un diagrama o archivo más pequeño.';
  } else if (err.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE') {
      statusCode = 413;
      message = esMensajeParaUsuario(err.message) ? err.message : 'El archivo es demasiado grande.';
  } else if (err.name === 'MulterError') {
      statusCode = 400;
      message = 'No se pudo recibir el archivo. Intenta subirlo de nuevo.';
  } else if (err.message === 'Not allowed by CORS') {
      statusCode = 403;
      message = 'Esta página no tiene permiso para usar el servidor.';
  } else {
      message = statusCode < 500 ? mensajeError(err, 'La solicitud no es válida.') : mensajeError(err);
  }
  res.status(statusCode).json({
      error: true,
      message,
  });
};

export default errorHandler;
