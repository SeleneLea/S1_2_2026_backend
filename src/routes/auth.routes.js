import { Router } from "express";
import userController from '../controllers/auth.controllers.js';

import { authRequired, checkNotAuthenticated } from '../middlewares/validateToken.js';
import userSchema from '../schemas/userSchema.js';
import validateSchema from '../middlewares/validateSchema.js';

const router = Router();

router.post('/register', checkNotAuthenticated, validateSchema(userSchema), userController.register);

router.post('/login', checkNotAuthenticated, userController.login);

// Sin authRequired: cerrar sesión debe funcionar incluso con token vencido
router.post('/logout', userController.logout);

router.get("/notEmail", authRequired, userController.getSalaByNotEmail);

router.get("/", authRequired, userController.profile);

router.delete("/", authRequired, userController.delete);

export default router;
