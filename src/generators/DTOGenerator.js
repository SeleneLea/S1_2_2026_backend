import ValidationUtils from './ValidationUtils.js';
import { muchosAMuchosEditables } from './Permisos.js';

class DTOGenerator {
    constructor(entities, relationships) {
        this.entities = entities;
        this.relationships = relationships;
    }

    isChildInInheritance(entityId) {
        return this.relationships.some(rel => {
            if (rel.type !== 'inheritance') return false;
            if (rel.source === entityId && rel.sourceMultiplicity && rel.sourceMultiplicity.includes('*')) {
                return true;
            }
            if (rel.target === entityId && rel.targetMultiplicity && rel.targetMultiplicity.includes('*')) {
                return true;
            }
            return false;
        });
    }

    getParentEntity(entityId) {
        const inheritanceRel = this.relationships.find(rel => {
            if (rel.type !== 'inheritance') return false;
            if (rel.source === entityId && rel.sourceMultiplicity && rel.sourceMultiplicity.includes('*')) {
                return true;
            }
            if (rel.target === entityId && rel.targetMultiplicity && rel.targetMultiplicity.includes('*')) {
                return true;
            }
            return false;
        });
        if (!inheritanceRel) return null;
        const parentId = inheritanceRel.sourceMultiplicity === '1' ?
            inheritanceRel.source :
            inheritanceRel.target;
        return this.entities.find(e => e.id === parentId);
    }

    /**
     * Con política explícita, ambos extremos admiten IDs; el servicio sincroniza
     * el lado propietario. Las colecciones heredadas ya están en el DTO padre.
     */
    getMuchosAMuchosPropios(entity) {
        return muchosAMuchosEditables(entity, this.entities, this.relationships, { heredadas: false }).map(r => r.otra);
    }

    generateAll() {
        const dtos = [];
        this.entities.forEach(entity => {
            dtos.push({
                name: `${entity.name}DTO.java`,
                content: this.generateDTO(entity)
            });
        });

        return dtos;
    }

    generateDTO(entity) {
        const isChildInInheritance = this.isChildInInheritance(entity.id);
        const parentEntity = isChildInInheritance ? this.getParentEntity(entity.id) : null;
        const normalAttributes = entity.attributes.filter(attr => {
            if (attr.isRelationshipAttribute || attr.isForeignKey) return false;
            // AJUSTADO: Solo excluir si es PK y estamos en herencia (el PK viene del padre)
            // Los demás atributos del hijo se incluyen aunque tengan el mismo nombre que alguno del padre
            if (isChildInInheritance && attr.isPrimaryKey) return false;
            return true;
        });
        const fkAttributes = entity.attributes.filter(attr => {
            if (!attr.isForeignKey || !attr.referencedEntity) return false;
            if (parentEntity && attr.referencedEntity === parentEntity.name) return false;
            return true;
        });
        const muchosAMuchos = this.getMuchosAMuchosPropios(entity);
        let usaValidaciones = false;
        let fields = '';
        let gettersSetters = '';
        normalAttributes.forEach(attr => {
            const javaType = this.mapTypeToJava(attr.type);
            const normalizedName = this.toCamelCase(attr.name);
            const capitalizedName = this.capitalize(normalizedName);
            // Las validaciones van en el DTO porque es lo que recibe el controlador con
            // @Valid: sin ellas un dato faltante llegaba a la base y respondía 500.
            const validaciones = attr.isPrimaryKey ? '' : ValidationUtils.generateValidationAnnotations(attr);
            if (validaciones) usaValidaciones = true;
            fields += `${validaciones}    private ${javaType} ${normalizedName};\n`;
            gettersSetters += `
    public ${javaType} get${capitalizedName}() {
        return ${normalizedName};
    }

    public void set${capitalizedName}(${javaType} ${normalizedName}) {
        this.${normalizedName} = ${normalizedName};
    }
`;
        });
        fkAttributes.forEach(attr => {
            const referencedEntity = this.entities.find(e => e.name === attr.referencedEntity);
            const pkType = referencedEntity ? this.getPrimaryKeyType(referencedEntity) : 'Long';
            const normalizedName = this.toCamelCase(attr.name);
            const fieldName = normalizedName + 'Id';
            const capitalizedName = this.capitalize(fieldName);
            // En una composición la parte no existe sin su todo
            if (attr.isRequired) {
                usaValidaciones = true;
                fields += `    @NotNull(message = "${fieldName} es obligatorio")\n`;
            }
            fields += `    private ${pkType} ${fieldName}; // FK to ${attr.referencedEntity}\n`;
            gettersSetters += `
    public ${pkType} get${capitalizedName}() {
        return ${fieldName};
    }

    public void set${capitalizedName}(${pkType} ${fieldName}) {
        this.${fieldName} = ${fieldName};
    }
`;
        });
        muchosAMuchos.forEach(otra => {
            const pkType = this.getPrimaryKeyType(otra);
            const fieldName = this.toCamelCase(otra.name) + 'Ids';
            const capitalizedName = this.capitalize(fieldName);
            fields += `    private List<${pkType}> ${fieldName}; // Muchos a muchos con ${otra.name}\n`;
            gettersSetters += `
    public List<${pkType}> get${capitalizedName}() {
        return ${fieldName};
    }

    public void set${capitalizedName}(List<${pkType}> ${fieldName}) {
        this.${fieldName} = ${fieldName};
    }
`;
        });
        const extendsClause = parentEntity ? ` extends ${parentEntity.name}DTO` : '';
        const imports = [
            usaValidaciones ? 'import jakarta.validation.constraints.*;' : '',
            muchosAMuchos.length ? 'import java.util.List;\nimport java.util.ArrayList;' : '',
            this.generateDTOImports(entity),
        ].filter(Boolean).join('\n');
        return `package com.example.demo.dto;

import java.io.Serializable;
${imports}

/**
 * DTO para ${entity.name}
 * Contiene los atributos principales de la entidad
 */
public class ${entity.name}DTO${extendsClause} implements Serializable {
    private static final long serialVersionUID = 1L;

${fields}

    public ${entity.name}DTO() {
    }

${gettersSetters}
}
`;
    }

    getRelationshipsForEntity(entityId) {
        return this.relationships
            .filter(rel => rel.source === entityId || rel.target === entityId)
            .map(rel => {
                const isSource = rel.source === entityId;
                const relatedEntityId = isSource ? rel.target : rel.source;
                const multiplicity = isSource ? rel.targetMultiplicity : rel.sourceMultiplicity;
                return {
                    relatedEntityId,
                    isCollection: multiplicity && multiplicity.includes('*'),
                    type: rel.type
                };
            });
    }

    generateDTOImports(entity) {
        const imports = new Set();
        entity.attributes.forEach(attr => {
            if (attr.type === 'LocalDate' || attr.type === 'Date') {
                imports.add('import java.time.LocalDate;');
            }
            if (attr.type === 'LocalDateTime') {
                imports.add('import java.time.LocalDateTime;');
            }
            if (attr.type === 'LocalTime') {
                imports.add('import java.time.LocalTime;');
            }
            if (attr.type === 'BigDecimal') {
                imports.add('import java.math.BigDecimal;');
            }
        });
        return Array.from(imports).join('\n');
    }

    getPrimaryKeyType(entity) {
        const pkAttr = entity.attributes.find(attr => attr.isPrimaryKey);
        if (!pkAttr) {
            // Buscar en el padre si es herencia
            const parentEntity = this.isChildInInheritance(entity.id) ? this.getParentEntity(entity.id) : null;
            if (parentEntity) {
                return this.getPrimaryKeyType(parentEntity);
            }
            return 'Long';
        }
        return this.mapTypeToJava(pkAttr.type);
    }

    mapTypeToJava(type) {
        const typeMap = {
            'String': 'String',
            'Integer': 'Integer',
            'Long': 'Long',
            'Double': 'Double',
            'Float': 'Float',
            'Boolean': 'Boolean',
            'Date': 'LocalDate',
            'LocalDate': 'LocalDate',
            'LocalDateTime': 'LocalDateTime',
            'LocalTime': 'LocalTime',
            'BigDecimal': 'BigDecimal'
        };
        return typeMap[type] || 'String';
    }

    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    toCamelCase(str) {
        if (str.includes('_')) {
            return str.split('_')
                .map((word, index) => {
                    if (index === 0) {
                        return word.toLowerCase();
                    }
                    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
                })
                .join('');
        }
        return str.charAt(0).toLowerCase() + str.slice(1);
    }
}

export default DTOGenerator;
