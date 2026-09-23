import { largoTexto } from './RestriccionesUML.js';

class ValidationUtils {
    static generateValidationAnnotations(attr) {
        if (attr.isPrimaryKey) return '';
        const obligatorio = attr.obligatorio !== false;
        const campo = String(attr.name).replace(/["\\\r\n]/g, '');
        let anotaciones = '';
        if (obligatorio) anotaciones += attr.type === 'String'
            ? `    @NotBlank(message = "${campo} no puede estar vacío")\n`
            : `    @NotNull(message = "${campo} no puede ser nulo")\n`;
        if (attr.type === 'String') {
            const minimo = attr.minimo ?? 0;
            const maximo = largoTexto(attr);
            if (minimo || maximo !== null) anotaciones += `    @Size(min = ${minimo}${maximo === null ? '' : `, max = ${maximo}`}, message = "Revisa el largo de ${campo}")\n`;
        } else if (['Integer', 'Long', 'Double', 'Float', 'BigDecimal'].includes(attr.type)) {
            for (const [clave, anotacion, texto] of [['minimo', 'DecimalMin', 'menor'], ['maximo', 'DecimalMax', 'mayor']]) {
                if (attr[clave] !== null && attr[clave] !== undefined) anotaciones += `    @${anotacion}(value = "${attr[clave]}", message = "${campo} no puede ser ${texto} que ${attr[clave]}")\n`;
            }
        }
        return anotaciones;
    }
    static generateCustomValidation() { return ''; }
}
export default ValidationUtils;
