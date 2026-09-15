import jwt from 'jsonwebtoken';
import { TOKEN_SECRET } from '../config.js';

export const authRequired = (req, res, next) => {
    let token = req.cookies.token;
    if (!token) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }
    }
    if (!token) {
        return res.status(401).json({ 
            error: true, 
            message: "No token provided. Please login again.",
            details: "Token not found in cookies or Authorization header"
        });
    }
    
    jwt.verify(token, TOKEN_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ 
                error: true, 
                message: "Invalid or expired token. Please login again.",
                details: err.message
            });
        }
        req.user = user;
        next();
    });
};

export const checkNotAuthenticated = (req, res, next) => {
  let token = req.cookies.token;
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }
  if (!token) return next();

  // Solo bloquear si el token es realmente VÁLIDO; un token vencido o
  // corrupto no debe impedir volver a iniciar sesión (antes causaba un
  // bloqueo: login decía "ya autenticado" y logout exigía token válido).
  jwt.verify(token, TOKEN_SECRET, (err) => {
    if (err) {
      res.clearCookie('token');
      return next();
    }
    return res.status(401).json({ error: true, message: "User already authenticated" });
  });
};
