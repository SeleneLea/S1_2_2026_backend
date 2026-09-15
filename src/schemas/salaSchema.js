import Joi from 'joi';

const salaSchema = Joi.object({
  title: Joi.string().trim().min(1).required().messages({
    'any.required': 'El título es requerido',
    'string.empty': 'El título no puede estar vacío',
    'string.min': 'El título debe tener al menos 1 carácter'
  }),
  xml: Joi.string().allow(null, ''),
  description: Joi.string().allow(null, ''),
  eliminar: Joi.boolean().default(false),
});

export default salaSchema;
