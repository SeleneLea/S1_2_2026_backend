// src/middlewares/validateSchema.js
import Joi from 'joi';

const validateSchema = (schema) => {
    return (req, res, next) => {
        const { error } = schema.validate(req.body, { abortEarly: false });
        if (error) {
            const errorMessages = error.details.map(detail => detail.message);
            const message = errorMessages.map((m) => (m.endsWith('.') ? m : `${m}.`)).join(' ');
            return res.status(400).json({ error: true, message, messages: errorMessages });
        }
        next();
    };
};

export default validateSchema;
