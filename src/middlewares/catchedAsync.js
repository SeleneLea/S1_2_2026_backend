export const catchedAsync = (fn) => {
  return (req, res, next) => {
      fn(req, res, next).catch(next);
  };
};
// response.js
export const response = (res, statusCode, data) => {
  res.status(statusCode).json({
      error: false,
      data
  });
};
// errorHandler.js
const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  res.status(statusCode).json({
      error: true,
      message,
  });
};

export default errorHandler;
