class ValidationUtils {
    
    static generateValidationAnnotations(attr) {
        let annotations = '';
        
        if (!attr.isPrimaryKey) {
            if (attr.type === 'String') {
                annotations += '    @NotBlank(message = "' + attr.name + ' no puede estar vacío")\n';
                // TEXT no tiene límite; el resto es VARCHAR (255 si no se indica). Sin
                // @Size, un texto largo llegaba a la base y respondía error de integridad.
                if (!/^TEXT$/i.test(attr.sqlType || '')) {
                    const length = attr.sqlType?.match(/\d+/)?.[0] || '255';
                    annotations += `    @Size(max = ${length}, message = "${attr.name} no puede exceder ${length} ${length === '1' ? 'carácter' : 'caracteres'}")\n`;
                }
            } else if (attr.type === 'Integer' || attr.type === 'Long') {
                annotations += '    @NotNull(message = "' + attr.name + ' no puede ser nulo")\n';
                annotations += '    @Min(value = 0, message = "' + attr.name + ' debe ser mayor o igual a 0")\n';
            } else if (attr.type === 'Double' || attr.type === 'BigDecimal') {
                annotations += '    @NotNull(message = "' + attr.name + ' no puede ser nulo")\n';
                annotations += '    @DecimalMin(value = "0.0", message = "' + attr.name + ' debe ser mayor o igual a 0")\n';
            } else {
                // Las fechas pueden ser futuras (vencimiento, baja programada): antes
                // @PastOrPresent las rechazaba y la app Flutter no lo advertía.
                annotations += '    @NotNull(message = "' + attr.name + ' no puede ser nulo")\n';
            }
        }
        
        return annotations;
    }

    static generateCustomValidation(entity) {
        return `
/**
 * Validación personalizada para ${entity.name}
 */
// @ValidEntity // Descomentar si se implementa validador personalizado
`;
    }
}

export default ValidationUtils;