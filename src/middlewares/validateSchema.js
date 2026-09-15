// src/middlewares/validateSchema.js
import Joi from 'joi';

const validateSchema = (schema) => {
    return (req, res, next) => {
        const { error } = schema.validate(req.body, { abortEarly: false });
        if (error) {
            const errorMessages = error.details.map(detail => detail.message);
            return res.status(400).json({ error: true, messages: errorMessages });
        }
        next();
    };
};

export default validateSchema;
