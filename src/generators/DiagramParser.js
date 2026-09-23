class DiagramParser {

    parse(xmlString) {
        try {
            const diagram = JSON.parse(xmlString);
            const entities = this.extractEntities(diagram);
            const relationships = this.extractRelationships(diagram);
            const manyToManyTables = this.extractManyToManyTables(diagram);
            return {
                entities: entities,
                relationships: relationships,
                manyToManyTables: manyToManyTables
            };
        } catch (error) {
            throw new Error(`Error parseando diagrama: ${error.message}`);
        }
    }

    extractEntities(diagram) {
        const entities = [];
        const elementsObj = diagram.elements || {};
        const elements = Object.values(elementsObj);
        for (const element of elements) {
            if (element.type === 'class' && element.stereotype !== 'association_table') {
                entities.push({
                    id: element.id,
                    name: element.name,
                    attributes: this.processAttributes(element.attributes || []),
                    methods: element.methods || [],
                    stereotype: element.stereotype,
                    isAbstract: element.isAbstract === true || element.stereotype === 'abstract',
                    visibility: element.visibility,
                    description: element.description || ''
                });
            }
        }
        return entities;
    }

    processAttributes(attributes) {
        return attributes.map(attr => ({
            name: attr.name,
            type: attr.type,
            sqlType: attr.sqlType,
            visibility: attr.visibility || 'private',
            isStatic: attr.isStatic || false,
            isPrimaryKey: attr.isPrimaryKey || false,
            isForeignKey: attr.isForeignKey || false,
            isRequired: attr.isRequired === true,
            referencedEntity: attr.referencedEntity,
            referencedField: attr.referencedField,
            referencedType: attr.referencedType,
            isRelationshipAttribute: attr.isRelationshipAttribute || false,
            defaultValue: attr.defaultValue
        }));
    }

    extractRelationships(diagram) {
        const relationships = [];
        const connectionsObj = diagram.connections || {};
        const connections = Object.values(connectionsObj);
        for (const conn of connections) {
            relationships.push({
                id: conn.id,
                source: conn.source,
                target: conn.target,
                type: conn.type,
                sourceMultiplicity: conn.sourceMultiplicity,
                targetMultiplicity: conn.targetMultiplicity,
                label: conn.label || '',
                associationTable: conn.associationTable,
                markerOrientation: conn.markerOrientation,
                manyToManyGroup: conn.manyToManyGroup,
                style: conn.style
            });
        }
        return relationships;
    }

    extractManyToManyTables(diagram) {
        const manyToManyTables = [];
        const elementsObj = diagram.elements || {};
        const elements = Object.values(elementsObj);
        for (const element of elements) {
            if (element.type === 'class' && element.stereotype === 'association_table') {
                const fkAttributes = element.attributes.filter(attr => attr.isForeignKey);
                manyToManyTables.push({
                    id: element.id,
                    name: element.name,
                    tableName: this.toSnakeCase(element.name),
                    attributes: this.processAttributes(element.attributes || []),
                    foreignKeys: fkAttributes.map(fk => ({
                        columnName: this.toSnakeCase(fk.name),
                        referencedEntity: fk.referencedEntity,
                        referencedField: fk.referencedField
                    })),
                    additionalAttributes: element.attributes.filter(attr => !attr.isForeignKey && !attr.isPrimaryKey)
                });
            }
        }
        return manyToManyTables;
    }

    getEntityById(entities, id) {
        return entities.find(entity => entity.id === id) || null;
    }

    getRelationshipsForEntity(relationships, entityId) {
        return {
            outgoing: relationships.filter(rel => rel.source === entityId),
            incoming: relationships.filter(rel => rel.target === entityId)
        };
    }

    analyzeRelationshipType(relationship) {
        const { type, sourceMultiplicity, targetMultiplicity } = relationship;
        const isSourceMany = sourceMultiplicity && sourceMultiplicity.includes('*');
        const isTargetMany = targetMultiplicity && targetMultiplicity.includes('*');
        let jpaType = '';
        let explanation = '';

        switch (type) {
            case 'association':
                if (isSourceMany && isTargetMany) {
                    jpaType = '@ManyToMany';
                    explanation = 'Muchos a Muchos - requiere tabla intermedia';
                } else if (isTargetMany) {
                    jpaType = '@OneToMany';
                    explanation = 'Uno a Muchos';
                } else if (isSourceMany) {
                    jpaType = '@ManyToOne';
                    explanation = 'Muchos a Uno';
                } else {
                    jpaType = '@OneToOne';
                    explanation = 'Uno a Uno';
                }
                break;

            case 'aggregation':
                jpaType = isTargetMany ? '@OneToMany' : '@ManyToOne';
                explanation = 'Agregación (relación débil)';
                break;

            case 'composition':
                jpaType = isTargetMany ? '@OneToMany' : '@ManyToOne';
                explanation = 'Composición (relación fuerte con cascade)';
                break;

            case 'dependency':
                jpaType = '@ManyToOne';
                explanation = 'Dependencia (sin cascade)';
                break;

            case 'many-to-many-direct':
                jpaType = '@ManyToMany';
                explanation = 'Muchos a Muchos directo';
                break;

            case 'inheritance':
                jpaType = '@Inheritance';
                explanation = 'Herencia de clases';
                break;

            case 'implementation':
                jpaType = 'Interface';
                explanation = 'Implementación de interfaz';
                break;

            default:
                jpaType = 'Unknown';
                explanation = 'Tipo de relación desconocido';
        }

        return {
            jpaType,
            explanation,
            isSourceMany,
            isTargetMany,
            originalType: type
        };
    }

    validateDiagram(diagram) {
        const errors = [];
        const warnings = [];
        diagram.entities.forEach(entity => {
            const hasPK = entity.attributes.some(attr => attr.isPrimaryKey);
            if (!hasPK) {
                warnings.push(`Entidad "${entity.name}" no tiene Primary Key definida`);
            }
        });
        diagram.relationships.forEach(rel => {
            const sourceExists = diagram.entities.some(e => e.id === rel.source);
            const targetExists = diagram.entities.some(e => e.id === rel.target);

            if (!sourceExists) {
                errors.push(`Relación ${rel.id}: Source entity no existe`);
            }
            if (!targetExists) {
                errors.push(`Relación ${rel.id}: Target entity no existe`);
            }
        });

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    isParentInInheritance(entityId) {
        return this.relationships.some(rel => {
            if (rel.type !== 'inheritance') return false;
            const sMult = rel.sourceMultiplicity || '';
            const tMult = rel.targetMultiplicity || '';
            if (rel.source === entityId && sMult === '1' && tMult.includes('*')) return true;
            if (rel.target === entityId && tMult === '1' && sMult.includes('*')) return true;
            return false;
        });
    }

    toSnakeCase(str) {
        return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    }

    toCamelCase(str) {
        return str.charAt(0).toLowerCase() + str.slice(1);
    }
}

export default DiagramParser;