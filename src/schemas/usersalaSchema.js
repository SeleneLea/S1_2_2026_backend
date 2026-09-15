import Joi from 'joi';

// Acepta invitación por email (preferido) o por userId directo.
const usersalaSchema = Joi.object({
  salas_id: Joi.number().integer().required().messages({
    'any.required': 'El ID de la sala es requerido',
    'number.base': 'El ID de la sala debe ser un número',
    'number.integer': 'El ID de la sala debe ser un entero'
  }),
  email: Joi.string().email().messages({
    'string.email': 'El email no es válido'
  }),
  userId: Joi.number().integer().messages({
    'number.base': 'El ID del usuario debe ser un número',
    'number.integer': 'El ID del usuario debe ser un entero'
  }),
}).or('email', 'userId').messages({
  'object.missing': 'Debe indicar el email o el userId del usuario a invitar'
});

export default usersalaSchema;
