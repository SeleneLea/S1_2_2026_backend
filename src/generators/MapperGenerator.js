class MapperGenerator {
    constructor(entities, relationships, metadata) {
        this.entities = entities;
        this.relationships = relationships || [];
        this.metadata = metadata;
    }

    isParentInInheritance(entityId) {
        return this.relationships.some(rel => {
            if (rel.type !== 'inheritance') return false;
            if (rel.source === entityId && rel.sourceMultiplicity === '1') {
                return true;
            }
            if (rel.target === entityId && rel.targetMultiplicity === '1') {
                return true;
            }
            return false;
        });
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
     * Muchos a muchos de los que esta entidad es dueña (lado con @JoinTable).
     * Mismo criterio que EntityGenerator y DTOGenerator.
     */
    getMuchosAMuchosPropios(entity) {
        return this.relationships
            .filter(rel => rel.type === 'many-to-many-direct' && rel.source === entity.id)
            .map(rel => this.entities.find(e => e.id === rel.target))
            .filter(Boolean)
            .filter(otra =>
                !entity.attributes.some(a => a.isForeignKey && a.referencedEntity === otra.name) &&
                !otra.attributes.some(a => a.isForeignKey && a.referencedEntity === entity.name)
            );
    }

    getPrimaryKeyGetter(entity) {
        const pkAttr = entity.attributes.find(attr => attr.isPrimaryKey);
        if (pkAttr) {
            // Si el PK es también FK (herencia JOINED), usar el campo referenciado
            const pkName = (pkAttr.isForeignKey && pkAttr.referencedField) ? pkAttr.referencedField : pkAttr.name;
            const normalizedName = this.toCamelCase(pkName);
            const capitalizedName = this.capitalize(normalizedName);
            const javaType = this.mapTypeToJava(pkAttr.type);
            return {
                getterName: `get${capitalizedName}`,
                type: javaType
            };
        }

        // Si no tiene PK propio, buscar en el padre (herencia)
        const parentEntity = this.isChildInInheritance(entity.id) ? this.getParentEntity(entity.id) : null;
        if (parentEntity) {
            return this.getPrimaryKeyGetter(parentEntity); // Recursivo
        }

        return { getterName: 'getId', type: 'Long' };
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

    generateAll() {
        return this.entities.map(entity => ({
            name: `${entity.name}Mapper.java`,
            content: this.generateMapper(entity)
        }));
    }

    generateMapper(entity) {
        const toDTO = this.generateToDTOMethod(entity);
        const toEntity = this.generateToEntityMethod(entity);
        const updateEntityFromDTO = this.generateUpdateEntityFromDTOMethod(entity);
        const relatedEntities = new Set();
        entity.attributes
            .filter(attr => attr.isForeignKey && attr.referencedEntity)
            .forEach(attr => relatedEntities.add(attr.referencedEntity));
        this.getMuchosAMuchosPropios(entity).forEach(otra => relatedEntities.add(otra.name));
        relatedEntities.delete(entity.name);
        const fkImports = Array.from(relatedEntities)
            .map(entityName => `import com.example.demo.entities.${entityName};`)
            .join('\n');
        return `package com.example.demo.mappers;

import com.example.demo.entities.${entity.name};
${fkImports ? fkImports + '\n' : ''}import com.example.demo.dto.${entity.name}DTO;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Mapper para convertir entre ${entity.name} y ${entity.name}DTO
 */
@Component
public class ${entity.name}Mapper {

    /**
     * Convertir Entity a DTO
     */
    public ${entity.name}DTO toDTO(${entity.name} entity) {
        if (entity == null) {
            return null;
        }

        ${entity.name}DTO dto = new ${entity.name}DTO();
${toDTO}
        return dto;
    }

    /**
     * Convertir DTO a Entity
     */
    public ${entity.name} toEntity(${entity.name}DTO dto) {
        if (dto == null) {
            return null;
        }

        ${entity.name} entity = new ${entity.name}();
${toEntity}
        return entity;
    }

    /**
     * Actualizar Entity desde DTO
     */
    public void updateEntityFromDTO(${entity.name} entity, ${entity.name}DTO dto) {
        if (entity == null || dto == null) {
            return;
        }
${updateEntityFromDTO}
    }

    /**
     * Convertir lista de Entities a lista de DTOs
     */
    public List<${entity.name}DTO> toDTOList(List<${entity.name}> entities) {
        if (entities == null) {
            return null;
        }
        return entities.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    /**
     * Convertir lista de DTOs a lista de Entities
     */
    public List<${entity.name}> toEntityList(List<${entity.name}DTO> dtos) {
        if (dtos == null) {
            return null;
        }
        return dtos.stream()
                .map(this::toEntity)
                .collect(Collectors.toList());
    }
}
`;
    }

    // Muchos a muchos: la entidad guarda objetos y el DTO solo sus IDs
    generateMuchosAMuchosToDTO(entity) {
        return this.getMuchosAMuchosPropios(entity).map(otra => {
            const coleccion = this.capitalize(this.toCamelCase(otra.name) + 's');
            const ids = this.capitalize(this.toCamelCase(otra.name) + 'Ids');
            const pkGetter = this.getPrimaryKeyGetter(otra).getterName;
            return `        if (entity.get${coleccion}() != null) {
            dto.set${ids}(entity.get${coleccion}().stream()
                .map(${otra.name}::${pkGetter})
                .collect(Collectors.toList()));
        }
`;
        }).join('');
    }

    // Objetos temporales con solo el ID: el servicio los reemplaza por los reales
    generateMuchosAMuchosToEntity(entity) {
        return this.getMuchosAMuchosPropios(entity).map(otra => {
            const coleccion = this.capitalize(this.toCamelCase(otra.name) + 's');
            const ids = this.capitalize(this.toCamelCase(otra.name) + 'Ids');
            const variable = this.toCamelCase(otra.name) + 'Temp';
            const pkSetter = this.getPrimaryKeyGetter(otra).getterName.replace('get', 'set');
            return `        // Muchos a muchos: ${otra.name} (objetos temporales con ID)
        if (dto.get${ids}() != null) {
            entity.set${coleccion}(dto.get${ids}().stream()
                .map(id -> {
                    ${otra.name} ${variable} = new ${otra.name}();
                    ${variable}.${pkSetter}(id);
                    return ${variable};
                })
                .collect(Collectors.toList()));
        }
`;
        }).join('');
    }

    /**
     * Atributos heredados (id incluido). La entidad hija extiende la del padre y su
     * DTO extiende el DTO del padre, pero el mapper solo copiaba los atributos
     * propios: el id y los campos del padre llegaban vacíos a la API.
     * modo: 'toDTO' | 'toEntity' | 'update'
     */
    generateHeredados(entity, modo) {
        const cadena = [];
        const vistos = new Set();
        for (let padre = this.isChildInInheritance(entity.id) ? this.getParentEntity(entity.id) : null;
            padre && !vistos.has(padre.id);
            padre = this.isChildInInheritance(padre.id) ? this.getParentEntity(padre.id) : null) {
            vistos.add(padre.id);
            cadena.unshift(padre);
        }
        // Un atributo propio con el mismo nombre ya se mapea (salvo la PK, que la hija omite)
        const mapeados = new Set(entity.attributes.filter(a => !a.isPrimaryKey).map(a => a.name));
        let code = '';
        cadena.forEach(ancestro => {
            ancestro.attributes.forEach(attr => {
                if (attr.isRelationshipAttribute || mapeados.has(attr.name)) return;
                mapeados.add(attr.name);
                const nombre = this.toCamelCase(attr.name);
                const cap = this.capitalize(nombre);
                if (attr.isForeignKey && attr.referencedEntity) {
                    const ref = this.entities.find(e => e.name === attr.referencedEntity);
                    const pkGetter = ref ? this.getPrimaryKeyGetter(ref).getterName : 'getId';
                    const tipo = `com.example.demo.entities.${attr.referencedEntity}`;
                    if (modo === 'toDTO') {
                        code += `        if (entity.get${cap}() != null) {\n            dto.set${cap}Id(entity.get${cap}().${pkGetter}());\n        }\n`;
                    } else {
                        code += `        if (dto.get${cap}Id() != null) {\n            ${tipo} ${nombre}Temp = new ${tipo}();\n            ${nombre}Temp.${pkGetter.replace('get', 'set')}(dto.get${cap}Id());\n            entity.set${cap}(${nombre}Temp);\n        }\n`;
                    }
                } else if (modo === 'toDTO') {
                    code += `        dto.set${cap}(entity.get${cap}());\n`;
                } else if (modo === 'toEntity') {
                    code += `        entity.set${cap}(dto.get${cap}());\n`;
                } else if (!attr.isPrimaryKey) {
                    code += `        if (dto.get${cap}() != null) {\n            entity.set${cap}(dto.get${cap}());\n        }\n`;
                }
            });
        });
        return code ? `        // Atributos heredados\n${code}` : '';
    }

    generateToDTOMethod(entity) {
        let code = '';
        const isChildInInheritance = this.isChildInInheritance(entity.id);
        const parentEntity = isChildInInheritance ? this.getParentEntity(entity.id) : null;
        const entityMeta = this.metadata ? this.metadata.get(entity.name) : null;
        const normalAttributes = entity.attributes.filter(attr => {
            if (attr.isRelationshipAttribute || attr.isForeignKey) return false;
            if (isChildInInheritance && attr.isPrimaryKey) return false;
            // AJUSTADO: No filtrar por nombre, solo excluir PKs heredadas
            return true;
        });

        const fkAttributes = entity.attributes.filter(attr => {
            if (!attr.isForeignKey || !attr.referencedEntity) return false;
            if (parentEntity && attr.referencedEntity === parentEntity.name) return false;
            return true;
        });

        normalAttributes.forEach(attr => {
            const normalizedName = this.toCamelCase(attr.name);
            const capitalizedName = this.capitalize(normalizedName);
            if (entityMeta && entityMeta.entity && entityMeta.dto) {
                const entityGetter = `get${capitalizedName}`;
                const dtoSetter = `set${capitalizedName}`;
                if (entityMeta.entity.getters.includes(entityGetter) &&
                    entityMeta.dto.setters.includes(dtoSetter)) {
                    code += `        dto.set${capitalizedName}(entity.get${capitalizedName}());\n`;
                } else {
                    console.warn(`⚠️  ${entity.name}.toDTO: Métodos no encontrados - ${entityGetter} o ${dtoSetter}`);
                    console.warn(`   SALTANDO mapeo del atributo '${normalizedName}'`);
                }
            } else {
                code += `        dto.set${capitalizedName}(entity.get${capitalizedName}());\n`;
            }
        });

        fkAttributes.forEach(attr => {
            const normalizedName = this.toCamelCase(attr.name);
            const capitalizedFieldName = this.capitalize(normalizedName);
            const dtoFieldName = normalizedName + 'Id';
            const capitalizedDtoFieldName = this.capitalize(dtoFieldName);
            const referencedEntity = this.entities.find(e => e.name === attr.referencedEntity);
            const pkGetter = referencedEntity ? this.getPrimaryKeyGetter(referencedEntity) : { getterName: 'getId', type: 'Long' };
            if (entityMeta && entityMeta.entity && entityMeta.dto) {
                const entityGetter = `get${capitalizedFieldName}`;
                const dtoSetter = `set${capitalizedDtoFieldName}`;
                if (entityMeta.entity.getters.includes(entityGetter) &&
                    entityMeta.dto.setters.includes(dtoSetter)) {
                    code += `        if (entity.get${capitalizedFieldName}() != null) {\n`;
                    code += `            dto.set${capitalizedDtoFieldName}(entity.get${capitalizedFieldName}().${pkGetter.getterName}());\n`;
                    code += `        }\n`;
                } else {
                    console.warn(`⚠️  ${entity.name}.toDTO FK: Métodos no encontrados`);
                    console.warn(`   Entity getter esperado: ${entityGetter} (disponibles: ${entityMeta.entity.getters.join(', ')})`);
                    console.warn(`   DTO setter esperado: ${dtoSetter} (disponibles: ${entityMeta.dto.setters.join(', ')})`);
                    console.warn(`   SALTANDO mapeo del FK '${normalizedName}'`);
                }
            } else {
                code += `        if (entity.get${capitalizedFieldName}() != null) {\n`;
                code += `            dto.set${capitalizedDtoFieldName}(entity.get${capitalizedFieldName}().${pkGetter.getterName}());\n`;
                code += `        }\n`;
            }
        });
        code += this.generateHeredados(entity, 'toDTO');
        code += this.generateMuchosAMuchosToDTO(entity);
        return code;
    }

    generateToEntityMethod(entity) {
        let code = '';
        const entityMeta = this.metadata ? this.metadata.get(entity.name) : null;
        const isChildInInheritance = this.isChildInInheritance(entity.id);
        const parentEntity = isChildInInheritance ? this.getParentEntity(entity.id) : null;
        const normalAttributes = entity.attributes.filter(attr => {
            if (attr.isRelationshipAttribute || attr.isForeignKey) return false;
            if (isChildInInheritance && attr.isPrimaryKey) return false;
            // AJUSTADO: No filtrar por nombre, solo excluir PKs heredadas
            return true;
        });
        normalAttributes.forEach(attr => {
            const normalizedName = this.toCamelCase(attr.name);
            const capitalizedName = this.capitalize(normalizedName);
            if (entityMeta && entityMeta.entity && entityMeta.dto) {
                const hasEntitySetter = entityMeta.entity.setters.includes(`set${capitalizedName}`);
                const hasDtoGetter = entityMeta.dto.getters.includes(`get${capitalizedName}`);
                if (hasEntitySetter && hasDtoGetter) {
                    code += `        entity.set${capitalizedName}(dto.get${capitalizedName}());\n`;
                }
            } else {
                code += `        entity.set${capitalizedName}(dto.get${capitalizedName}());\n`;
            }
        });
        const fkAttributes = entity.attributes.filter(attr => {
            if (!attr.isForeignKey || !attr.referencedEntity) return false;
            if (parentEntity && attr.referencedEntity === parentEntity.name) return false;
            return true;
        });
        fkAttributes.forEach(attr => {
            const normalizedName = this.toCamelCase(attr.name);
            const capitalizedFieldName = this.capitalize(normalizedName);
            const dtoFieldName = normalizedName + 'Id';
            const capitalizedDtoFieldName = this.capitalize(dtoFieldName);
            const referencedEntity = this.entities.find(e => e.name === attr.referencedEntity);
            const pkGetter = referencedEntity ? this.getPrimaryKeyGetter(referencedEntity) : { getterName: 'getId', type: 'Long' };
            const pkSetterName = pkGetter.getterName.replace('get', 'set');
            code += `        // Mapear FK: ${normalizedName} (crear objeto temporal con ID)
        if (dto.get${capitalizedDtoFieldName}() != null) {
            ${attr.referencedEntity} ${normalizedName}Temp = new ${attr.referencedEntity}();
            ${normalizedName}Temp.${pkSetterName}(dto.get${capitalizedDtoFieldName}());
            entity.set${capitalizedFieldName}(${normalizedName}Temp);
        }
`;
        });
        code += this.generateHeredados(entity, 'toEntity');
        code += this.generateMuchosAMuchosToEntity(entity);
        return code;
    }

    generateUpdateEntityFromDTOMethod(entity) {
        let code = '';
        const entityMeta = this.metadata ? this.metadata.get(entity.name) : null;
        const isChildInInheritance = this.isChildInInheritance(entity.id);
        const parentEntity = isChildInInheritance ? this.getParentEntity(entity.id) : null;
        let parentAttributeNames = [];
        if (parentEntity) {
            parentAttributeNames = parentEntity.attributes.map(attr => attr.name);
        }
        const ownAttributes = entity.attributes.filter(attr => {
            if (attr.isRelationshipAttribute || attr.isForeignKey || attr.isPrimaryKey) return false;
            if (isChildInInheritance && parentAttributeNames.includes(attr.name)) return false;
            return true;
        });
        ownAttributes.forEach(attr => {
            const normalizedName = this.toCamelCase(attr.name);
            const capitalizedName = this.capitalize(normalizedName);
            if (entityMeta && entityMeta.entity && entityMeta.dto) {
                const hasEntityGetter = entityMeta.entity.getters.includes(`get${capitalizedName}`);
                const hasEntitySetter = entityMeta.entity.setters.includes(`set${capitalizedName}`);
                const hasDtoGetter = entityMeta.dto.getters.includes(`get${capitalizedName}`);

                if (hasEntityGetter && hasEntitySetter && hasDtoGetter) {
                    code += `        if (dto.get${capitalizedName}() != null) {
            entity.set${capitalizedName}(dto.get${capitalizedName}());
        }
`;
                }
            } else {
                code += `        if (dto.get${capitalizedName}() != null) {
            entity.set${capitalizedName}(dto.get${capitalizedName}());
        }
`;
            }
        });
        const fkAttributes = entity.attributes.filter(attr => {
            if (!attr.isForeignKey || !attr.referencedEntity) return false;
            if (parentEntity && attr.referencedEntity === parentEntity.name) return false;
            return true;
        });
        if (fkAttributes.length > 0) {
            code += `\n        // Actualizar Foreign Keys desde DTO\n`;
            fkAttributes.forEach(attr => {
                const normalizedName = this.toCamelCase(attr.name);
                const capitalizedFieldName = this.capitalize(normalizedName);
                const dtoFieldName = normalizedName + 'Id';
                const capitalizedDtoFieldName = this.capitalize(dtoFieldName);

                const referencedEntity = this.entities.find(e => e.name === attr.referencedEntity);
                const pkGetter = referencedEntity ? this.getPrimaryKeyGetter(referencedEntity) : { getterName: 'getId', type: 'Long' };
                const pkSetterName = pkGetter.getterName.replace('get', 'set');

                code += `        if (dto.get${capitalizedDtoFieldName}() != null) {
            ${attr.referencedEntity} ${normalizedName}Temp = new ${attr.referencedEntity}();
            ${normalizedName}Temp.${pkSetterName}(dto.get${capitalizedDtoFieldName}());
            entity.set${capitalizedFieldName}(${normalizedName}Temp);
        }
`;
            });
        }
        code += this.generateHeredados(entity, 'update');
        code += this.generateMuchosAMuchosToEntity(entity);
        return code;
    }

    getPrimaryKeyName(entity) {
        const parentEntity = this.getParentEntity(entity.id);
        if (parentEntity) {
            const parentPkAttr = parentEntity.attributes.find(attr => attr.isPrimaryKey);
            if (parentPkAttr) {
                return parentPkAttr.name;
            }
        }
        const pkAttr = entity.attributes.find(attr => attr.isPrimaryKey);
        if (pkAttr) {
            return pkAttr.name;
        }
        return 'id';
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

export default MapperGenerator;
