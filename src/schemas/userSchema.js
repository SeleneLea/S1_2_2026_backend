// src/schemas/userSchema.js
import Joi from 'joi';

const userSchema = Joi.object({
  name: Joi.string().trim().required().messages({
    'any.required': 'El nombre es requerido',
    'string.empty': 'El nombre no puede estar vacío'
  }),
  email: Joi.string().email().trim().required().messages({
    'any.required': 'El correo electrónico es requerido',
    'string.empty': 'El correo electrónico no puede estar vacío',
    'string.email': 'El correo electrónico debe ser válido'
  }),
  password: Joi.string().min(8).required().messages({
    'any.required': 'La contraseña es requerida',
    'string.empty': 'La contraseña no puede estar vacía',
    'string.min': 'La contraseña debe tener al menos 8 caracteres'
  }),
});

export default userSchema;
