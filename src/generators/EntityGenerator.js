import ValidationUtils from './ValidationUtils.js';

class EntityGenerator {
    constructor(entities, relationships, manyToManyTables = []) {
        this.entities = entities;
        this.relationships = relationships;
        this.manyToManyTables = manyToManyTables;
        this.relationshipMap = this.buildRelationshipMap();
    }

    buildRelationshipMap() {
        const map = new Map();
        this.relationships.forEach(rel => {
            if (!map.has(rel.source)) map.set(rel.source, []);
            if (!map.has(rel.target)) map.set(rel.target, []);
            map.get(rel.source).push({ ...rel, direction: 'outgoing' });
            map.get(rel.target).push({ ...rel, direction: 'incoming' });
        });
        return map;
    }

    isParentInInheritance(entityId) {
        return this.relationships.some(rel => {
            if (rel.type !== 'inheritance') return false;
            const sMult = rel.sourceMultiplicity || '';
            const tMult = rel.targetMultiplicity || '';
            // parent is the side with multiplicity exactly '1'
            if (rel.source === entityId && sMult === '1' && tMult.includes('*')) return true;
            if (rel.target === entityId && tMult === '1' && sMult.includes('*')) return true;
            return false;
        });
    }

    isChildInInheritance(entityId) {
        return this.relationships.some(rel => {
            if (rel.type !== 'inheritance') return false;
            const sMult = rel.sourceMultiplicity || '';
            const tMult = rel.targetMultiplicity || '';
            if (rel.source === entityId && sMult.includes('*') && tMult === '1') return true;
            if (rel.target === entityId && tMult.includes('*') && sMult === '1') return true;
            return false;
        });
    }

    getParentEntity(entityId) {
        // Find inheritance relation where this entity is the child (the side with '*')
        const inheritanceRel = this.relationships.find(rel => {
            if (rel.type !== 'inheritance') return false;
            const sMult = rel.sourceMultiplicity || '';
            const tMult = rel.targetMultiplicity || '';
            if (rel.source === entityId && sMult.includes('*') && tMult === '1') return true;
            if (rel.target === entityId && tMult.includes('*') && sMult === '1') return true;
            return false;
        });
        if (!inheritanceRel) return null;
        const sMult = inheritanceRel.sourceMultiplicity || '';
        const parentId = sMult === '1' ? inheritanceRel.source : inheritanceRel.target;
        return this.entities.find(e => e.id === parentId) || null;
    }

    hasInheritanceBetween(aId, bId) {
        return this.relationships.some(rel => {
            if (rel.type !== 'inheritance') return false;
            return (rel.source === aId && rel.target === bId) || (rel.source === bId && rel.target === aId);
        });
    }

    isManyInRelationship(entity, relationship) {
        const relatedEntityId = relationship.source === entity.id ? relationship.target : relationship.source;
        const relatedEntity = this.entities.find(e => e.id === relatedEntityId);
        if (relatedEntity) {
            const hasFKToRelated = entity.attributes.some(attr =>
                attr.isForeignKey && attr.referencedEntity === relatedEntity.name
            );
            if (hasFKToRelated) return true;
        }
        if (relationship.source === entity.id) {
            return relationship.sourceMultiplicity && relationship.sourceMultiplicity.includes('*');
        }
        if (relationship.target === entity.id) {
            return relationship.targetMultiplicity && relationship.targetMultiplicity.includes('*');
        }
        return false;
    }

    isOneInRelationship(entity, relationship) {
        const relatedEntityId = relationship.source === entity.id ? relationship.target : relationship.source;
        const relatedEntity = this.entities.find(e => e.id === relatedEntityId);
        if (relatedEntity) {
            const hasFKToRelated = entity.attributes.some(attr =>
                attr.isForeignKey && attr.referencedEntity === relatedEntity.name
            );
            if (hasFKToRelated) return false;
        }
        if (relationship.source === entity.id) {
            return relationship.sourceMultiplicity === '1';
        }
        if (relationship.target === entity.id) {
            return relationship.targetMultiplicity === '1';
        }
        return false;
    }

    getManyToOneRelationships(entity) {
        const result = [];
        entity.attributes
            .filter(attr => attr.isForeignKey && attr.referencedEntity)
            .forEach(attr => {
                const relatedEntity = this.entities.find(e => e.name === attr.referencedEntity);
                if (relatedEntity) {
                    const relationship = this.relationships.find(rel =>
                        (rel.source === entity.id && rel.target === relatedEntity.id) ||
                        (rel.target === entity.id && rel.source === relatedEntity.id)
                    );
                    if (relationship && relationship.type !== 'inheritance') {
                        result.push({ relationship, relatedEntity, fkAttribute: attr });
                    }
                }
            });
        return result;
    }

    getOneToManyRelationships(entity) {
        const result = [];
        this.relationships.forEach(rel => {
            if (rel.type === 'inheritance' || rel.type === 'implementation') return;
            if (rel.type === 'many-to-many-direct') return;
            const isTarget = rel.target === entity.id;
            const isSource = rel.source === entity.id;
            if (isTarget) {
                const sourceEntity = this.entities.find(e => e.id === rel.source);
                if (sourceEntity) {
                    const sourceHasFKToThis = sourceEntity.attributes.some(attr =>
                        attr.isForeignKey && attr.referencedEntity === entity.name
                    );
                    const targetMultiplicity = rel.targetMultiplicity;
                    const isTargetMany = targetMultiplicity && targetMultiplicity.includes('*');
                    if (sourceHasFKToThis && isTargetMany) {
                        result.push({ relationship: rel, relatedEntity: sourceEntity });
                    }
                }
            } else if (isSource) {
                const targetEntity = this.entities.find(e => e.id === rel.target);
                if (targetEntity) {
                    const targetHasFKToThis = targetEntity.attributes.some(attr =>
                        attr.isForeignKey && attr.referencedEntity === entity.name
                    );
                    const sourceMultiplicity = rel.sourceMultiplicity;
                    const isSourceMany = sourceMultiplicity && sourceMultiplicity.includes('*');
                    if (targetHasFKToThis && isSourceMany) {
                        result.push({ relationship: rel, relatedEntity: targetEntity });
                    }
                }
            }
        });
        this.entities.forEach(otherEntity => {
            if (otherEntity.id === entity.id) return;
            const hasFKToThis = otherEntity.attributes.some(attr =>
                attr.isForeignKey && attr.referencedEntity === entity.name
            );
            if (hasFKToThis) {
                // Don't add a OneToMany synthesized from FK if the relation between these entities is inheritance
                if (this.hasInheritanceBetween(otherEntity.id, entity.id)) return;
                const alreadyAdded = result.some(r => r.relatedEntity.id === otherEntity.id);
                if (!alreadyAdded) {
                    result.push({ relationship: null, relatedEntity: otherEntity });
                }
            }
        });
        return result;
    }

    /**
     * Colecciones @OneToMany del lado "uno": una por cada FK que apunta a esta
     * entidad. Si otra entidad tiene varias FK hacia esta (p. ej. "origen" y
     * "destino"), cada una necesita su propia lista con su mappedBy; antes se
     * generaba una sola y la segunda relación quedaba sin mapear.
     */
    getColeccionesInversas(entity) {
        const result = [];
        const vistas = new Set();
        this.getOneToManyRelationships(entity).forEach(({ relatedEntity }) => {
            if (vistas.has(relatedEntity.id)) return;
            vistas.add(relatedEntity.id);
            const fks = relatedEntity.attributes.filter(attr =>
                attr.isForeignKey && attr.referencedEntity === entity.name
            );
            const base = this.toCamelCase(relatedEntity.name) + 's';
            fks.forEach(fkAttr => {
                const fieldName = fks.length > 1 ? base + this.capitalize(this.toCamelCase(fkAttr.name)) : base;
                result.push({ relatedEntity, fkAttr, fieldName });
            });
        });
        return result;
    }

    generateAll() {
        return this.entities.map(entity => ({
            name: `${entity.name}.java`,
            content: this.generateEntity(entity)
        }));
    }

    generateEntity(entity) {
        const relationships = this.relationshipMap.get(entity.id) || [];
        const imports = this.generateImports(entity, relationships);
        const classAnnotations = this.generateClassAnnotations(entity);
        const fields = this.generateFields(entity, relationships);
        const constructors = this.generateConstructors(entity);
        const gettersSetters = this.generateGettersSetters(entity, relationships);
        const operaciones = this.generateOperacionesUML(entity, gettersSetters);
        const parentEntity = this.getParentEntity(entity.id);
        const extendsClause = parentEntity ? ` extends ${parentEntity.name}` : '';
        // UML 2.5: una clase marcada como abstracta se genera abstracta en Java
        const abstractKeyword = (entity.isAbstract || entity.stereotype === 'abstract') ? 'abstract ' : '';
        return `package com.example.demo.entities;

${imports}

${classAnnotations}
public ${abstractKeyword}class ${entity.name}${extendsClause} {

${fields}

${constructors}

${gettersSetters}
${operaciones}
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ${entity.name})) return false;
        ${parentEntity ? `if (!super.equals(o)) return false;` : ''}${parentEntity ? '' : `\n        ${entity.name} that = (${entity.name}) o;\n        return ${this.generateEqualsComparison(entity, relationships)};`}${parentEntity ? '\n        return true;' : ''}
    }

    @Override
    public int hashCode() {
        return ${parentEntity ? 'super.hashCode()' : `Objects.hash(${this.generateHashCodeFields(entity, relationships)})`};
    }
}
`;
    }

    generateImports(entity, relationships) {
        const imports = new Set([
            'import jakarta.persistence.*;',
            'import jakarta.validation.constraints.*;',
            'import java.util.Objects;',
            'import com.fasterxml.jackson.annotation.JsonIgnoreProperties;',
            'import com.fasterxml.jackson.annotation.JsonSetter;'
        ]);
        entity.attributes.forEach(attr => {
            if (attr.type === 'Date' || attr.type === 'LocalDate') {
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
        let hasCollections = this.getColeccionesInversas(entity).length > 0;
        relationships.forEach(rel => {
            const isSource = rel.source === entity.id;
            const multiplicity = isSource ? rel.targetMultiplicity : rel.sourceMultiplicity;
            if (multiplicity && multiplicity.includes('*')) {
                hasCollections = true;
            }
        });
        if (hasCollections) {
            imports.add('import java.util.List;');
            imports.add('import java.util.ArrayList;');
        }
        const usaMappedSuperclass = entity
            && (entity.isAbstract || entity.stereotype === 'abstract')
            && !this.isParentInInheritance(entity.id);
        if (usaMappedSuperclass) {
            imports.add('import jakarta.persistence.MappedSuperclass;');
        }
        return Array.from(imports).join('\n');
    }

    generateClassAnnotations(entity) {
        const tableName = this.toSnakeCase(entity.name);
        const esAbstracta = entity.isAbstract || entity.stereotype === 'abstract';
        // Abstracta y sin hijos: no le corresponde tabla propia -> superclase mapeada
        if (esAbstracta && !this.isParentInInheritance(entity.id)) {
            return '@MappedSuperclass';
        }
        let annotations = `@Entity\n@Table(name = "${tableName}")`;
        if (this.isParentInInheritance(entity.id)) {
            annotations += `\n@Inheritance(strategy = InheritanceType.JOINED)`;
        }
        if (this.isChildInInheritance(entity.id)) {
            const pkAttribute = entity.attributes.find(attr => attr.isPrimaryKey);
            if (pkAttribute) {
                const columnName = this.toSnakeCase(pkAttribute.name);
                annotations += `\n@PrimaryKeyJoinColumn(name = "${columnName}")`;
            }
        }
        return annotations;
    }

    generateFields(entity, relationships) {
        let code = '';
        const isChildInInheritance = this.isChildInInheritance(entity.id);
        const parentEntity = isChildInInheritance ? this.getParentEntity(entity.id) : null;
        
        // Obtener nombres de atributos del padre para evitar redeclaración
        const parentAttrNames = parentEntity ? parentEntity.attributes.map(a => a.name) : [];
        
        entity.attributes.forEach(attr => {
            if (attr.isPrimaryKey && isChildInInheritance) {
                return;
            }
            // NUEVO: Evitar redeclarar atributos que ya existen en el padre (por nombre)
            if (isChildInInheritance && parentAttrNames.includes(attr.name)) {
                return;
            }
            if (attr.isForeignKey && parentEntity && attr.referencedEntity === parentEntity.name) {
                return;
            }
            if (attr.isForeignKey && attr.referencedEntity) {
                code += this.generateManyToOneField(attr, entity);
            }
            else {
                code += this.generateField(attr);
            }
        });
        // Una colección por cada FK que apunta a esta entidad
        this.getColeccionesInversas(entity).forEach(coleccion => {
            code += this.generateOneToManyField(entity, coleccion);
        });
        const manyToManyRelationships = this.getManyToManyRelationships(entity);
        const processedManyToMany = new Set();
        manyToManyRelationships.forEach(({ relationship, relatedEntity, isOwner }) => {
            const fieldName = this.toCamelCase(relatedEntity.name) + 's';
            if (processedManyToMany.has(fieldName)) return;
            processedManyToMany.add(fieldName);
            code += this.generateManyToManyField(entity, relatedEntity, relationship, isOwner);
        });

        return code;
    }

    getManyToManyRelationships(entity) {
        const result = [];
        this.relationships.forEach(rel => {
            if (rel.type !== 'many-to-many-direct') return;
            const isSource = rel.source === entity.id;
            const isTarget = rel.target === entity.id;
            if (!isSource && !isTarget) return;
            const otherEntityId = isSource ? rel.target : rel.source;
            const otherEntity = this.entities.find(e => e.id === otherEntityId);
            if (!otherEntity) return;
            const sourceMult = rel.sourceMultiplicity;
            const targetMult = rel.targetMultiplicity;
            const isManyToMany = sourceMult && sourceMult.includes('*') &&
                targetMult && targetMult.includes('*');
            if (!isManyToMany) return;
            const entityHasFKToOther = entity.attributes.some(attr =>
                attr.isForeignKey && attr.referencedEntity === otherEntity.name
            );
            const otherHasFKToEntity = otherEntity.attributes.some(attr =>
                attr.isForeignKey && attr.referencedEntity === entity.name
            );
            if (entityHasFKToOther || otherHasFKToEntity) {
                return;
            }
            if (isSource) {
                result.push({
                    relationship: rel,
                    relatedEntity: otherEntity,
                    isOwner: true
                });
            } else {
                result.push({
                    relationship: rel,
                    relatedEntity: otherEntity,
                    isOwner: false
                });
            }
        });
        return result;
    }

    generateManyToOneField(attr, entity) {
        const referencedEntity = attr.referencedEntity;
        const fieldName = this.toCamelCase(attr.name);
        // Convencion relacional: la columna FK termina en _id aunque el campo
        // Java se llame como la entidad (cliente -> columna cliente_id).
        const base = this.toSnakeCase(attr.name);
        const columnName = base.endsWith('_id') ? base : `${base}_id`;
        // En una composición la parte no existe sin su todo: la FK es obligatoria
        const obligatoria = attr.isRequired === true;
        let code = '\n';
        code += `    @ManyToOne(fetch = FetchType.LAZY${obligatoria ? ', optional = false' : ''})\n`;
        code += `    @JoinColumn(name = "${columnName}", nullable = ${obligatoria ? 'false' : 'true'})\n`;
        code += `    @JsonIgnoreProperties(value = {"hibernateLazyInitializer", "handler"}, allowSetters = true)\n`;
        code += `    private ${referencedEntity} ${fieldName};\n`;
        return code;
    }

    generateOneToManyField(entity, { relatedEntity, fkAttr, fieldName }) {
        const mappedBy = this.toCamelCase(fkAttr.name);
        // Solo la composición propaga las operaciones a sus partes (y borra las
        // huérfanas). Antes CascadeType.ALL iba en TODAS las relaciones: eliminar una
        // categoría eliminaba sus productos y, en cadena, el historial de ventas.
        // La relación se busca por el par de entidades porque puede llegar null.
        const esComposicion = this.relationships.some(r =>
            r.type === 'composition' &&
            ((r.source === entity.id && r.target === relatedEntity.id) ||
             (r.source === relatedEntity.id && r.target === entity.id))
        );
        const cascada = esComposicion ? ', cascade = CascadeType.ALL, orphanRemoval = true' : '';
        let code = '\n';
        code += `    @OneToMany(mappedBy = "${mappedBy}", fetch = FetchType.LAZY${cascada})\n`;
        code += `    @JsonIgnoreProperties(value = {"${mappedBy}", "hibernateLazyInitializer", "handler"}, allowSetters = true)\n`;
        code += `    private List<${relatedEntity.name}> ${fieldName} = new ArrayList<>();\n`;
        return code;
    }

    generateManyToManyField(entity, relatedEntity, relationship, isOwner) {
        const fieldName = this.toCamelCase(relatedEntity.name) + 's';
        const inverseFieldName = this.toCamelCase(entity.name) + 's';
        let code = '\n';
        if (isOwner) {
            const tableName = relationship.associationTable
                ? this.toSnakeCase(relationship.associationTable.replace('assoc_class_', ''))
                : this.toSnakeCase(entity.name) + '_' + this.toSnakeCase(relatedEntity.name);
            code += `    @ManyToMany(fetch = FetchType.LAZY, cascade = {CascadeType.PERSIST, CascadeType.MERGE})\n`;
            code += `    @JoinTable(\n`;
            code += `        name = "${tableName}",\n`;
            code += `        joinColumns = @JoinColumn(name = "${this.toSnakeCase(entity.name)}_id"),\n`;
            code += `        inverseJoinColumns = @JoinColumn(name = "${this.toSnakeCase(relatedEntity.name)}_id")\n`;
            code += `    )\n`;
            code += `    @JsonIgnoreProperties(value = {"${inverseFieldName}", "hibernateLazyInitializer", "handler"}, allowSetters = true)\n`;
        } else {
            const mappedByFieldName = this.toCamelCase(entity.name) + 's';
            code += `    @ManyToMany(mappedBy = "${mappedByFieldName}", fetch = FetchType.LAZY)\n`;
            code += `    @JsonIgnoreProperties(value = {"${inverseFieldName}", "hibernateLazyInitializer", "handler"}, allowSetters = true)\n`;
        }
        code += `    private List<${relatedEntity.name}> ${fieldName} = new ArrayList<>();\n`;
        return code;
    }

    generateField(attr) {
        let code = '\n';
        if (attr.isPrimaryKey) {
            code += '    @Id\n';
            if (attr.type === 'Long' || attr.type === 'Integer') {
                code += '    @GeneratedValue(strategy = GenerationType.IDENTITY)\n';
            }
        }
        const columnName = this.toSnakeCase(attr.name);
        code += `    @Column(name = "${columnName}"`;
        if (attr.isPrimaryKey) {
            code += ', nullable = false';
        }
        if (attr.type === 'String') {
            if (/^TEXT$/i.test(attr.sqlType || '')) {
                // text y geometrías WKT: sin límite de largo, igual que el script SQL
                code += ', columnDefinition = "TEXT"';
            } else {
                const length = attr.sqlType?.match(/\d+/)?.[0] || '255';
                code += `, length = ${length}`;
            }
        }
        code += ')\n';
        if (!attr.isPrimaryKey) {
            code += ValidationUtils.generateValidationAnnotations(attr);
        }
        const javaType = this.mapTypeToJava(attr.type);
        const defaultValue = this.getDefaultValue(attr);
        const normalizedName = this.toCamelCase(attr.name);
        code += `    private ${javaType} ${normalizedName}${defaultValue};\n`;
        return code;
    }

    generateColumnDefinition(attr) {
        const parts = [];
        const columnName = this.toSnakeCase(attr.name);
        if (columnName !== attr.name) {
            parts.push(`name = "${columnName}"`);
        }
        if (attr.isPrimaryKey) {
            parts.push('nullable = false');
        }
        if (attr.type === 'String') {
            const length = attr.sqlType?.match(/\d+/)?.[0] || '255';
            parts.push(`length = ${length}`);
        }
        return parts.length > 0 ? parts.join(', ') : null;
    }

    getDefaultValue(attr) {
        if (attr.defaultValue === null || attr.defaultValue === undefined) {
            return '';
        }
        if (attr.type === 'String') {
            return ` = ${attr.defaultValue}`;
        } else if (attr.type === 'Integer' || attr.type === 'Long' || attr.type === 'Double') {
            return ` = ${attr.defaultValue}`;
        }
        return '';
    }

    generateRelationshipField(entity, rel) {
        const isSource = rel.source === entity.id;
        const relatedEntityId = isSource ? rel.target : rel.source;
        const relatedEntity = this.entities.find(e => e.id === relatedEntityId);
        if (!relatedEntity) return '';
        const multiplicity = isSource ? rel.targetMultiplicity : rel.sourceMultiplicity;
        const isCollection = multiplicity && multiplicity.includes('*');
        let code = '\n';
        switch (rel.type) {
            case 'inheritance':
                if (!isSource) {
                    return '';
                } else {
                    return '';
                }

            case 'implementation':
                return '';

            case 'association':
                return this.generateAssociationField(entity, relatedEntity, rel, isSource, isCollection);

            case 'aggregation':
                return this.generateAggregationField(entity, relatedEntity, rel, isSource, isCollection);

            case 'composition':
                return this.generateCompositionField(entity, relatedEntity, rel, isSource, isCollection);

            case 'dependency':
                return this.generateDependencyField(entity, relatedEntity, rel, isSource);

            case 'many-to-many-direct':
                if (rel.associationTable) {
                    const assocTable = this.manyToManyTables.find(t => 
                        t.id === rel.associationTable || t.name === rel.associationTable
                    );                    
                    if (assocTable) {
                        return '';
                    }
                }
                return this.generateManyToManyField(entity, relatedEntity, rel, isSource);

            default:
                return '';
        }
    }

    generateAssociationField(entity, relatedEntity, rel, isSource, isCollection) {
        let code = '\n';
        const fieldName = isCollection
            ? this.toCamelCase(relatedEntity.name) + 's'
            : this.toCamelCase(relatedEntity.name);
        if (isCollection) {
            const mappedBy = this.toCamelCase(entity.name);
            code += `    @OneToMany(mappedBy = "${mappedBy}", cascade = {CascadeType.PERSIST, CascadeType.MERGE})\n`;
            code += `    @JsonIgnoreProperties("${mappedBy}")\n`;
            code += `    private List<${relatedEntity.name}> ${fieldName} = new ArrayList<>();\n`;
        } else {
            const columnName = this.toSnakeCase(relatedEntity.name) + '_id';
            code += `    @ManyToOne\n`;
            code += `    @JoinColumn(name = "${columnName}")\n`;
            code += `    @JsonIgnoreProperties("${this.toCamelCase(entity.name)}s")\n`;
            code += `    private ${relatedEntity.name} ${fieldName};\n`;
        }
        return code;
    }

    generateAggregationField(entity, relatedEntity, rel, isSource, isCollection) {
        let code = '\n';
        const fieldName = isCollection
            ? this.toCamelCase(relatedEntity.name) + 's'
            : this.toCamelCase(relatedEntity.name);
        if (isSource && !isCollection) {
            const columnName = this.toSnakeCase(relatedEntity.name) + '_id';
            code += `    @ManyToOne(cascade = {CascadeType.PERSIST, CascadeType.MERGE})\n`;
            code += `    @JoinColumn(name = "${columnName}")\n`;
            code += `    @JsonIgnoreProperties("${this.toCamelCase(entity.name)}s")\n`;
            code += `    private ${relatedEntity.name} ${fieldName};\n`;
        } else if (!isSource && isCollection) {
            const mappedBy = this.toCamelCase(entity.name);
            code += `    @OneToMany(mappedBy = "${mappedBy}", cascade = {CascadeType.PERSIST, CascadeType.MERGE})\n`;
            code += `    @JsonIgnoreProperties("${mappedBy}")\n`;
            code += `    private List<${relatedEntity.name}> ${fieldName} = new ArrayList<>();\n`;
        }
        return code;
    }

    generateCompositionField(entity, relatedEntity, rel, isSource, isCollection) {
        let code = '\n';
        const fieldName = isCollection
            ? this.toCamelCase(relatedEntity.name) + 's'
            : this.toCamelCase(relatedEntity.name);
        if (isSource && !isCollection) {
            const columnName = this.toSnakeCase(relatedEntity.name) + '_id';
            code += `    @ManyToOne(cascade = CascadeType.ALL)\n`;
            code += `    @JoinColumn(name = "${columnName}")\n`;
            code += `    @JsonIgnoreProperties("${this.toCamelCase(entity.name)}s")\n`;
            code += `    private ${relatedEntity.name} ${fieldName};\n`;
        } else if (!isSource && isCollection) {
            const mappedBy = this.toCamelCase(entity.name);
            code += `    @OneToMany(mappedBy = "${mappedBy}", cascade = CascadeType.ALL, orphanRemoval = true)\n`;
            code += `    @JsonIgnoreProperties("${mappedBy}")\n`;
            code += `    private List<${relatedEntity.name}> ${fieldName} = new ArrayList<>();\n`;
        }
        return code;
    }

    generateDependencyField(entity, relatedEntity, rel, isSource) {
        if (!isSource) return '';
        let code = '\n';
        const fieldName = this.toCamelCase(relatedEntity.name);
        const columnName = this.toSnakeCase(relatedEntity.name) + '_id';
        code += `    @ManyToOne\n`;
        code += `    @JoinColumn(name = "${columnName}")\n`;
        code += `    @JsonIgnoreProperties("${this.toCamelCase(entity.name)}s")\n`;
        code += `    private ${relatedEntity.name} ${fieldName};\n`;
        return code;
    }

    generateManyToManyField(entity, relatedEntity, rel, isSource) {
        let code = '\n';
        const fieldName = this.toCamelCase(relatedEntity.name) + 's';
        if (isSource) {
            const tableName = rel.associationTable
                ? this.toSnakeCase(rel.associationTable.replace('assoc_class_', ''))
                : this.toSnakeCase(entity.name) + '_' + this.toSnakeCase(relatedEntity.name);
            const colPropia = `${this.toSnakeCase(entity.name)}_id`;
            const colOtra = `${this.toSnakeCase(relatedEntity.name)}_id`;
            code += `    @ManyToMany\n`;
            // UNIQUE: la misma pareja no puede repetirse en la tabla intermedia
            code += `    @JoinTable(
        name = "${tableName}",
        joinColumns = @JoinColumn(name = "${colPropia}"),
        inverseJoinColumns = @JoinColumn(name = "${colOtra}"),
        uniqueConstraints = @UniqueConstraint(columnNames = {"${colPropia}", "${colOtra}"})
    )\n`;
        } else {
            code += `    @ManyToMany(mappedBy = "${this.toCamelCase(entity.name)}s")\n`;
        }
        code += `    @JsonIgnoreProperties("${this.toCamelCase(entity.name)}s")\n`;
        code += `    private List<${relatedEntity.name}> ${fieldName} = new ArrayList<>();\n`;
        return code;
    }

    /**
     * Operaciones declaradas en el diagrama (p. ej. "+ calcularTotal(): BigDecimal").
     * Antes se descartaban y el diseño perdía su comportamiento al pasar a código.
     * Se generan como métodos pendientes de implementar; se omiten los que chocan
     * con un getter/setter ya generado o no son identificadores Java válidos.
     */
    generateOperacionesUML(entity, codigoExistente = '') {
        const RESERVADAS = new Set([
            'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
            'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
            'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
            'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
            'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
            'volatile', 'while', 'equals', 'hashCode', 'toString', 'getClass'
        ]);
        const esIdentificador = (n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n || '') && !RESERVADAS.has(n);
        const entidades = new Set(this.entities.map(e => e.name));
        const PRIMITIVOS = { int: 'Integer', long: 'Long', double: 'Double', float: 'Float', boolean: 'Boolean', char: 'Character', byte: 'Byte', short: 'Short' };
        // Nombres completos: la entidad solo importa los tipos de sus atributos
        const TIPOS = {
            string: 'String', integer: 'Integer', long: 'Long', double: 'Double', float: 'Float',
            boolean: 'Boolean', bool: 'Boolean', bigdecimal: 'java.math.BigDecimal',
            date: 'java.time.LocalDate', localdate: 'java.time.LocalDate',
            localdatetime: 'java.time.LocalDateTime', localtime: 'java.time.LocalTime', void: 'void'
        };
        const tipoJava = (t) => {
            const limpio = String(t || '').trim();
            if (!limpio) return 'void';
            if (entidades.has(limpio) || PRIMITIVOS[limpio]) return limpio;
            const lista = limpio.match(/^List\s*<\s*(\w+)\s*>$/);
            if (lista) {
                const interno = tipoJava(lista[1]);
                return `java.util.List<${PRIMITIVOS[interno] || interno}>`;
            }
            return TIPOS[limpio.toLowerCase()] || 'Object';
        };
        const VISIBILIDAD = { '+': 'public ', '-': 'private ', '#': 'protected ', '~': '', public: 'public ', private: 'private ', protected: 'protected ', package: '' };
        const parsear = (m) => {
            if (m && typeof m === 'object') {
                return {
                    vis: VISIBILIDAD[m.visibility] ?? 'public ',
                    nombre: String(m.name || '').trim(),
                    params: (m.parameters || []).map(p => ({ nombre: String(p?.name ?? p?.nombre ?? '').trim(), tipo: p?.type ?? p?.tipo })),
                    retorno: m.returnType || 'void'
                };
            }
            const r = String(m || '').trim().match(/^([+\-#~])?\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?::\s*(.+))?$/);
            if (!r) return null;
            return {
                vis: VISIBILIDAD[r[1] || '+'],
                nombre: r[2],
                params: r[3].trim()
                    ? r[3].split(',').map(p => {
                        const [nombre, tipo] = p.split(':').map(x => x.trim());
                        return { nombre, tipo };
                    })
                    : [],
                retorno: (r[4] || 'void').trim()
            };
        };

        const firmas = new Set();
        let code = '';
        (entity.methods || []).forEach(m => {
            const op = parsear(m);
            if (!op || !esIdentificador(op.nombre)) return;
            if (codigoExistente.includes(` ${op.nombre}(`)) return;
            const usados = new Set();
            const params = op.params.map((p, i) => {
                const nombre = esIdentificador(p.nombre) && !usados.has(p.nombre) ? p.nombre : `arg${i}`;
                usados.add(nombre);
                return { tipo: tipoJava(p.tipo || 'String'), nombre };
            });
            const firma = `${op.nombre}(${params.map(p => p.tipo).join(',')})`;
            if (firmas.has(firma)) return;
            firmas.add(firma);
            const descripcion = typeof m === 'string' ? m.trim() : `${op.nombre}(...)`;
            code += `
    /**
     * Operación del diagrama: ${descripcion.replace(/\*\//g, '* /')}
     * TODO: implementar la lógica de negocio.
     */
    ${op.vis}${tipoJava(op.retorno)} ${op.nombre}(${params.map(p => `${p.tipo} ${p.nombre}`).join(', ')}) {
        throw new UnsupportedOperationException("${op.nombre} aún no está implementado");
    }
`;
        });
        if (!code) return '';
        return `
    // ========================================
    // OPERACIONES DEL DIAGRAMA DE CLASES
    // ========================================
${code}`;
    }

    generateConstructors(entity) {
        return `    // Constructor vacío requerido por JPA
    public ${entity.name}() {
    }
`;
    }

    generateGettersSetters(entity, relationships) {
        let code = '';
        const processedGetters = new Set();
        const isChildInInheritance = this.isChildInInheritance(entity.id);
        const parentEntity = isChildInInheritance ? this.getParentEntity(entity.id) : null;
        let parentAttributes = [];
        if (parentEntity) {
            parentAttributes = parentEntity.attributes.map(attr => attr.name);
        }
        entity.attributes
            .filter(attr => !attr.isForeignKey)
            .filter(attr => {
                if (isChildInInheritance && attr.isPrimaryKey) {
                    return false;
                }
                if (isChildInInheritance && parentAttributes.includes(attr.name)) {
                    return false;
                }
                return true;
            })
            .forEach(attr => {
                const javaType = this.mapTypeToJava(attr.type);
                const normalizedName = this.toCamelCase(attr.name);
                const capitalizedName = this.capitalize(normalizedName);
                code += `
    public ${javaType} get${capitalizedName}() {
        return ${normalizedName};
    }

    public void set${capitalizedName}(${javaType} ${normalizedName}) {
        this.${normalizedName} = ${normalizedName};
    }
`;
            });
        entity.attributes
            .filter(attr => attr.isForeignKey && attr.referencedEntity)
            .forEach(attr => {
                if (parentEntity && attr.referencedEntity === parentEntity.name) {
                    return;
                }
                const fieldName = this.toCamelCase(attr.name);
                const capitalizedName = this.capitalize(fieldName);
                const referencedEntity = attr.referencedEntity;
                const refEntity = this.entities.find(e => e.name === referencedEntity);
                
                // MEJORADO: Obtener PK considerando herencia
                const pkType = refEntity ? this.getPrimaryKeyType(refEntity) : 'Long';
                const pkName = refEntity ? this.getPrimaryKeyName(refEntity) : 'id';
                const normalizedPkName = this.toCamelCase(pkName);
                const capitalizedPkName = this.capitalize(normalizedPkName);
                if (processedGetters.has(fieldName)) return;
                processedGetters.add(fieldName);
                code += `
    public ${referencedEntity} get${capitalizedName}() {
        return ${fieldName};
    }

    public void set${capitalizedName}(${referencedEntity} ${fieldName}) {
        this.${fieldName} = ${fieldName};
    }
    
    // Setter adicional que acepta solo el ID y crea un objeto temporal
    @com.fasterxml.jackson.annotation.JsonSetter("${fieldName}FromId")
    public void set${capitalizedName}FromId(Object idOrEntity) {
        if (idOrEntity == null) {
            this.${fieldName} = null;
        } else if (idOrEntity instanceof ${referencedEntity}) {
            this.${fieldName} = (${referencedEntity}) idOrEntity;
        } else {
            ${referencedEntity} temp = new ${referencedEntity}();
            ${this.generateIdConversion(pkType, 'idOrEntity', `temp.set${capitalizedPkName}`)}
            this.${fieldName} = temp;
        }
    }
`;
            });
        this.getColeccionesInversas(entity).forEach(({ relatedEntity, fieldName }) => {
            const capitalizedName = this.capitalize(fieldName);
            if (processedGetters.has(fieldName)) return;
            processedGetters.add(fieldName);
            code += `
    public List<${relatedEntity.name}> get${capitalizedName}() {
        return ${fieldName};
    }

    public void set${capitalizedName}(List<${relatedEntity.name}> ${fieldName}) {
        this.${fieldName} = ${fieldName};
    }
`;
        });
        const manyToManyRelationships = this.getManyToManyRelationships(entity);
        manyToManyRelationships.forEach(({ relationship, relatedEntity }) => {
            const fieldName = this.toCamelCase(relatedEntity.name) + 's';
            const capitalizedName = this.capitalize(fieldName);
            if (processedGetters.has(fieldName)) return;
            processedGetters.add(fieldName);
            code += `
    public List<${relatedEntity.name}> get${capitalizedName}() {
        return ${fieldName};
    }

    public void set${capitalizedName}(List<${relatedEntity.name}> ${fieldName}) {
        this.${fieldName} = ${fieldName};
    }
`;
        });
        return code;
    }

    generateEqualsComparison(entity, relationships) {
        if (this.isChildInInheritance(entity.id)) {
            return 'true';
        }
        const pkAttrs = entity.attributes.filter(attr => attr.isPrimaryKey);
        if (pkAttrs.length === 0) return 'false';
        return pkAttrs.map(attr => {
            const normalizedName = this.toCamelCase(attr.name);
            return `Objects.equals(${normalizedName}, that.${normalizedName})`;
        }).join(' && ');
    }

    generateHashCodeFields(entity, relationships) {
        if (this.isChildInInheritance(entity.id)) {
            return '';
        }
        const pkAttrs = entity.attributes.filter(attr => attr.isPrimaryKey);
        return pkAttrs.map(attr => {
            const normalizedName = this.toCamelCase(attr.name);
            return normalizedName;
        }).join(', ');
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

    toSnakeCase(str) {
        return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
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

    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    getPrimaryKeyName(entity) {
        const pkAttr = entity.attributes.find(attr => attr.isPrimaryKey);
        if (pkAttr) {
            // Si el PK es también FK (herencia JOINED), usar el campo referenciado
            if (pkAttr.isForeignKey && pkAttr.referencedField) {
                return pkAttr.referencedField;
            }
            return pkAttr.name;
        }
        
        // Si no tiene PK propio, buscar en el padre (herencia)
        const parentEntity = this.isChildInInheritance(entity.id) ? this.getParentEntity(entity.id) : null;
        if (parentEntity) {
            return this.getPrimaryKeyName(parentEntity); // Recursivo para herencia multinivel
        }
        
        return 'id';
    }
    
    /**
     * Obtiene el tipo Java del PK considerando herencia
     */
    getPrimaryKeyType(entity) {
        const pkAttr = entity.attributes.find(attr => attr.isPrimaryKey);
        if (pkAttr) return this.mapTypeToJava(pkAttr.type);
        
        // Si no tiene PK propio, buscar en el padre (herencia)
        const parentEntity = this.isChildInInheritance(entity.id) ? this.getParentEntity(entity.id) : null;
        if (parentEntity) {
            return this.getPrimaryKeyType(parentEntity); // Recursivo
        }
        
        return 'Long';
    }

    generateIdConversion(javaType, varName, setterCall) {
        if (javaType === 'String') {
            return `${setterCall}(${varName}.toString());`;
        } else if (javaType === 'Long') {
            return `if (${varName} instanceof Number) {
                ${setterCall}(((Number) ${varName}).longValue());
            } else {
                ${setterCall}(Long.parseLong(${varName}.toString()));
            }`;
        } else if (javaType === 'Integer') {
            return `if (${varName} instanceof Number) {
                ${setterCall}(((Number) ${varName}).intValue());
            } else {
                ${setterCall}(Integer.parseInt(${varName}.toString()));
            }`;
        } else if (javaType === 'Double') {
            return `if (${varName} instanceof Number) {
                ${setterCall}(((Number) ${varName}).doubleValue());
            } else {
                ${setterCall}(Double.parseDouble(${varName}.toString()));
            }`;
        } else if (javaType === 'Float') {
            return `if (${varName} instanceof Number) {
                ${setterCall}(((Number) ${varName}).floatValue());
            } else {
                ${setterCall}(Float.parseFloat(${varName}.toString()));
            }`;
        } else {
            return `if (${varName} instanceof Number) {
                ${setterCall}(((Number) ${varName}).longValue());
            } else {
                ${setterCall}(Long.parseLong(${varName}.toString()));
            }`;
        }
    }

    getNumberConversion(javaType) {
        if (javaType === 'Long') return 'longValue';
        if (javaType === 'Integer') return 'intValue';
        if (javaType === 'Double') return 'doubleValue';
        if (javaType === 'Float') return 'floatValue';
        return 'longValue';
    }

    getStringConversion(javaType, varName) {
        if (javaType === 'Long') return `Long.parseLong(${varName}.toString())`;
        if (javaType === 'Integer') return `Integer.parseInt(${varName}.toString())`;
        if (javaType === 'Double') return `Double.parseDouble(${varName}.toString())`;
        if (javaType === 'Float') return `Float.parseFloat(${varName}.toString())`;
        if (javaType === 'String') return `${varName}.toString()`;
        return `Long.parseLong(${varName}.toString())`;
    }
}

export default EntityGenerator;