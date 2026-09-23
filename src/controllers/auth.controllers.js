import { createUser, verifyUserCredentials, getUserById, deleteUser, getUserByEmail, getUsersExcludingId } from '../models/auth.model.js';
import { createAccesToken } from '../libs/jwt.js';
import { opcionesCookie } from '../libs/cookies.js';
import { catchedAsync, response } from '../middlewares/catchedAsync.js';

// Alineado con expiresIn del JWT (1 día)
const DURACION_SESION_MS = 24 * 60 * 60 * 1000;

class AuthController {
    constructor() {}

    register = catchedAsync(async (req, res) => {
        const { name, email, password } = req.body;
        try {
            const user = await createUser(name, email, password);
            if (!user) {
                return response(res, 400, {
                    error: true,
                    message: 'Ya existe una cuenta con ese correo. Inicia sesión o usa otro correo.'
                });
            }
            const userALter = await getUserByEmail(email);
            if (!userALter) {
                return response(res, 500, {
                    error: true,
                    message: 'La cuenta se creó, pero no se pudo iniciar la sesión. Intenta iniciar sesión con tu correo y contraseña.'
                });
            }
            const token = await createAccesToken({ id: userALter.id });
            res.cookie('token', token, opcionesCookie(req, { maxAge: DURACION_SESION_MS }));
            response(res, 200, {
                token,
                user: { id: userALter.id, name: userALter.name, email: userALter.email },
                message: 'Cuenta creada correctamente'
            });
        } catch (error) {
            console.error('Error en registro:', error);
            return response(res, 500, {
                error: true,
                message: 'No se pudo crear la cuenta por un problema del servidor. Intenta de nuevo en unos segundos.'
            });
        }
    });

    login = catchedAsync(async (req, res) => {
        const { email, password } = req.body;
        const user = await verifyUserCredentials(email, password);
        if (!user) {
            return response(res, 401, {
                error: true,
                message: 'El correo o la contraseña no son correctos. Revisa que estén bien escritos.'
            });
        }
        const token = await createAccesToken({ id: user.id });
        res.cookie('token', token, opcionesCookie(req, { maxAge: DURACION_SESION_MS }));
        response(res, 200, {
            token,
            user: { id: user.id, name: user.name, email: user.email },
            message: 'Sesión iniciada'
        });
    });

    logout = catchedAsync(async (req, res) => {
        res.cookie('token', '', opcionesCookie(req, { expires: new Date(0) }));
        response(res, 200, { msg: 'Sesión cerrada' });
    });

    profile = catchedAsync(async (req, res) => {
        const user = await getUserById(req.user.id);
        response(res, 200, user);
    });

    getSalaByNotEmail = catchedAsync(async (req, res) => {
        const userId = req.user.id;
        const sala = await getUsersExcludingId(userId);
        response(res, 200, sala);
    });

    delete = catchedAsync(async (req, res) => {
        const user = await deleteUser(req.user.id);
        res.cookie('token', '', opcionesCookie(req, { expires: new Date(0) }));
        response(res, 200, user);
    });
}

export default new AuthController();
