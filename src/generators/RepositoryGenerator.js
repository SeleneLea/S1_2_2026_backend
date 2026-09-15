
// Los metodos derivados usan los tipos de los atributos en sus firmas
// (findByFecha(LocalDateTime), existsByPrecio(BigDecimal)...). Sin estos imports
// el proyecto NO compila, aunque la entidad si los importe.
const importsDeTipos = (entity) => {
    const tipos = new Set((entity.attributes || []).map(a => a.type));
    const lineas = [];
    if (tipos.has('LocalDateTime')) lineas.push('import java.time.LocalDateTime;');
    if (tipos.has('LocalDate')) lineas.push('import java.time.LocalDate;');
    if (tipos.has('LocalTime')) lineas.push('import java.time.LocalTime;');
    if (tipos.has('BigDecimal')) lineas.push('import java.math.BigDecimal;');
    return lineas.length ? lineas.join(String.fromCharCode(10)) + String.fromCharCode(10) : '';
};

class RepositoryGenerator {
    constructor(entities, relationships, metadata) {
        this.entities = entities;
        this.relationships = relationships || [];
        this.metadata = metadata;
    }

    generateAll() {
        return this.entities.map(entity => ({
            name: `${entity.name}Repository.java`,
            content: this.generateRepository(entity)
        }));
    }

    generateRepository(entity) {
        const pkType = this.getPrimaryKeyType(entity);
        const customMethods = this.generateCustomMethods(entity);
        const isCompositeKey = this.isCompositeKey(entity);
        const relatedEntities = new Set();
        entity.attributes
            .filter(attr => attr.isForeignKey && attr.referencedEntity)
            .forEach(attr => relatedEntities.add(attr.referencedEntity));
        const relatedImports = Array.from(relatedEntities)
            .map(entityName => `import com.example.demo.entities.${entityName};`)
            .join('\n');
        
        return `package com.example.demo.repositories;

import com.example.demo.entities.${entity.name};
${relatedImports}
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

${importsDeTipos(entity)}import java.util.List;
import java.util.Optional;

/**
 * Repositorio para la entidad ${entity.name}
 * Proporciona operaciones CRUD y consultas personalizadas
 */
@Repository
public interface ${entity.name}Repository extends JpaRepository<${entity.name}, ${pkType}> {

${customMethods}
}
`;
    }

    generateCustomMethods(entity) {
        let methods = `    // ========================================
    // MÉTODOS DE BÚSQUEDA PERSONALIZADOS
    // ========================================\n`;
        const entityMeta = this.metadata ? this.metadata.get(entity.name) : null;
        entity.attributes
            .filter(attr => !attr.isPrimaryKey && !attr.isRelationshipAttribute && !attr.isForeignKey)
            .slice(0, 3) 
            .forEach(attr => {
                const javaType = this.mapTypeToJava(attr.type);
                const normalizedName = this.toCamelCase(attr.name);
                const capName = this.capitalize(normalizedName);
                if (entityMeta && entityMeta.entity) {
                    const hasGetter = entityMeta.entity.getters.includes(`get${capName}`);
                    if (!hasGetter) {
                        console.warn(`⚠️  ${entity.name}Repository: Método get${capName}() no existe en Entity`);
                        console.warn(`   Disponibles: ${entityMeta.entity.getters.join(', ')}`);
                        console.warn(`   SALTANDO métodos findBy${capName}, existsBy${capName}, countBy${capName}`);
                        return;
                    }
                }
                
                // List y no Optional: estos campos no son únicos (dos productos pueden
                // tener el mismo precio) y Optional lanzaría una excepción con 2+ filas.
                methods += `    /**
     * Buscar todos por ${normalizedName}
     */
    List<${entity.name}> findBy${capName}(${javaType} ${normalizedName});
    
    /**
     * Verificar si existe por ${normalizedName}
     */
    boolean existsBy${capName}(${javaType} ${normalizedName});
    
    /**
     * Contar por ${normalizedName}
     */
    long countBy${capName}(${javaType} ${normalizedName});
    
`;
            });
        
        const parentEntity = this.getParentEntity(entity.id);
        entity.attributes
            .filter(attr => attr.isForeignKey && attr.referencedEntity)
            .filter(attr => !(parentEntity && attr.referencedEntity === parentEntity.name)) // Excluir FK hacia el padre
            .forEach(attr => {
                const normalizedFieldName = this.toCamelCase(attr.name);
                const capFieldName = this.capitalize(normalizedFieldName);
                const referencedEntity = this.entities.find(e => e.name === attr.referencedEntity);
                const pkType = referencedEntity ? this.getPrimaryKeyType(referencedEntity) : 'Long';
                const pkName = referencedEntity ? this.getPrimaryKeyName(referencedEntity) : 'id';
                const normalizedPkName = this.toCamelCase(pkName);
                const capPkName = this.capitalize(normalizedPkName);
                methods += `    /**
     * Buscar todos por ${attr.referencedEntity}
     */
    List<${entity.name}> findBy${capFieldName}(${attr.referencedEntity} ${normalizedFieldName});
    
    /**
     * Buscar todos por ${capPkName} de ${attr.referencedEntity}
     */
    List<${entity.name}> findBy${capFieldName}${capPkName}(${pkType} ${normalizedFieldName}${capPkName});
    
    /**
     * Verificar si existe por ${attr.referencedEntity}
     */
    boolean existsBy${capFieldName}(${attr.referencedEntity} ${normalizedFieldName});
    
    /**
     * Contar por ${attr.referencedEntity}
     */
    long countBy${capFieldName}(${attr.referencedEntity} ${normalizedFieldName});
    
`;
            });
        return methods;
    }

    getPrimaryKeyType(entity) {
        const pkAttr = entity.attributes.find(attr => attr.isPrimaryKey);
        if (!pkAttr) {
            // Buscar en el padre si es herencia
            const parentEntity = this.getParentEntity(entity.id);
            if (parentEntity) {
                return this.getPrimaryKeyType(parentEntity);
            }
            return 'Long';
        }
        return this.mapTypeToJava(pkAttr.type);
    }

    getPrimaryKeyName(entity) {
        const pkAttr = entity.attributes.find(attr => attr.isPrimaryKey);
        if (!pkAttr) {
            // Buscar en el padre si es herencia
            const parentEntity = this.getParentEntity(entity.id);
            if (parentEntity) {
                return this.getPrimaryKeyName(parentEntity);
            }
            return 'id';
        }
        
        // Si el PK es también FK (herencia JOINED), usar el campo referenciado
        if (pkAttr.isForeignKey && pkAttr.referencedField) {
            return pkAttr.referencedField;
        }
        return pkAttr.name;
    }
    
    getParentEntity(entityId) {
        const inheritanceRel = this.relationships.find(rel =>
            rel.type === 'inheritance' &&
            (rel.source === entityId || rel.target === entityId) &&
            rel.sourceMultiplicity === '1' &&
            rel.targetMultiplicity.includes('*')
        );
        if (!inheritanceRel) return null;
        const parentId = inheritanceRel.sourceMultiplicity === '1' ?
            inheritanceRel.source :
            inheritanceRel.target;
        return this.entities.find(e => e.id === parentId);
    }

    isCompositeKey(entity) {
        const pkAttrs = entity.attributes.filter(attr => attr.isPrimaryKey);
        return pkAttrs.length > 1;
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

export default RepositoryGenerator;