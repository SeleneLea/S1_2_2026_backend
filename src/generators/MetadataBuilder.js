class MetadataBuilder {
    constructor(entities, relationships) {
        this.entities = entities;
        this.relationships = relationships || [];
        this.metadata = new Map();
    }

    build() {
        this.entities.forEach(entity => {
            const meta = {
                entityName: entity.name,
                attributes: this.analyzeAttributes(entity),
                inheritance: this.analyzeInheritance(entity),
                relationships: this.analyzeRelationships(entity),
                entity: this.predictEntityMethods(entity),
                dto: this.predictDTOMethods(entity),
                mapper: this.predictMapperMethods(entity),
                service: this.predictServiceMethods(entity),
                controller: this.predictControllerMethods(entity),
                repository: this.predictRepositoryMethods(entity)
            };
            this.metadata.set(entity.name, meta);
        });
        return this.metadata;
    }

    analyzeAttributes(entity) {
        const parentEntity = this.getParentEntity(entity.id);
        const parentAttrNames = parentEntity ? parentEntity.attributes.map(a => a.name) : [];
        return {
            all: entity.attributes.map(attr => ({
                name: attr.name,
                javaType: this.mapTypeToJava(attr.type),
                isPK: attr.isPrimaryKey || false,
                isFK: attr.isForeignKey || false,
                referencedEntity: attr.referencedEntity || null,
                isInherited: parentAttrNames.includes(attr.name)
            })),
            own: entity.attributes.filter(attr => {
                if (attr.isRelationshipAttribute) return false;
                if (parentEntity && attr.isPrimaryKey) return false;
                if (parentEntity && parentAttrNames.includes(attr.name)) return false;
                return true;
            }).map(attr => ({
                name: attr.name,
                javaType: this.mapTypeToJava(attr.type),
                isPK: attr.isPrimaryKey || false,
                isFK: attr.isForeignKey || false,
                referencedEntity: attr.referencedEntity || null
            })),
            foreignKeys: entity.attributes.filter(attr => 
                attr.isForeignKey && attr.referencedEntity
            ).map(attr => ({
                fieldName: attr.name,
                referencedEntity: attr.referencedEntity,
                javaType: attr.referencedEntity
            })),
            primaryKey: this.getPrimaryKey(entity)
        };
    }

    analyzeInheritance(entity) {
        const parentEntity = this.getParentEntity(entity.id);
        return {
            isChild: !!parentEntity,
            isParent: this.isParentInInheritance(entity.id),
            parentEntity: parentEntity ? parentEntity.name : null
        };
    }

    analyzeRelationships(entity) {
        return {
            manyToOne: this.getManyToOneRelationships(entity),
            oneToMany: this.getOneToManyRelationships(entity),
            manyToMany: this.getManyToManyRelationships(entity)
        };
    }

    predictEntityMethods(entity) {
        const methods = { getters: [], setters: [] };
        const parentEntity = this.getParentEntity(entity.id);
        const parentAttrNames = parentEntity ? parentEntity.attributes.map(a => a.name) : [];
        
        entity.attributes
            .filter(attr => {
                if (attr.isRelationshipAttribute || attr.isForeignKey) return false;
                if (parentEntity && attr.isPrimaryKey) return false;
                if (parentEntity && parentAttrNames.includes(attr.name)) return false;
                return true;
            })
            .forEach(attr => {
                const normalizedName = this.toCamelCase(attr.name);
                const cap = this.capitalize(normalizedName);
                methods.getters.push(`get${cap}`);
                methods.setters.push(`set${cap}`);
            });
        
        entity.attributes
            .filter(attr => attr.isForeignKey && attr.referencedEntity)
            .filter(attr => {
                if (parentEntity && attr.referencedEntity === parentEntity.name) return false;
                return true;
            })
            .forEach(attr => {
                const normalizedName = this.toCamelCase(attr.name);
                const cap = this.capitalize(normalizedName);
                methods.getters.push(`get${cap}`);
                methods.setters.push(`set${cap}`);
            });
        // Mismos nombres que EntityGenerator: una colección por cada FK entrante
        this.nombresColeccionesInversas(entity).forEach(fieldName => {
            const cap = this.capitalize(fieldName);
            methods.getters.push(`get${cap}`);
            methods.setters.push(`set${cap}`);
        });
        const manyToMany = this.getManyToManyRelationships(entity);
        manyToMany.forEach(rel => {
            const fieldName = this.toCamelCase(rel.relatedEntity.name) + 's';
            const cap = this.capitalize(fieldName);
            methods.getters.push(`get${cap}`);
            methods.setters.push(`set${cap}`);
        });
        return { getters: methods.getters, setters: methods.setters };
    }

    predictDTOMethods(entity) {
        const methods = { getters: [], setters: [] };
        const parentEntity = this.getParentEntity(entity.id);
        const parentAttrNames = parentEntity ? parentEntity.attributes.map(a => a.name) : [];
        entity.attributes
            .filter(attr => {
                if (attr.isRelationshipAttribute || attr.isForeignKey) return false;
                if (parentEntity && parentAttrNames.includes(attr.name)) return false;
                return true;
            })
            .forEach(attr => {
                const normalizedName = this.toCamelCase(attr.name);
                const cap = this.capitalize(normalizedName);
                methods.getters.push(`get${cap}`);
                methods.setters.push(`set${cap}`);
            });
        entity.attributes
            .filter(attr => attr.isForeignKey && attr.referencedEntity)
            .filter(attr => {
                if (parentEntity && attr.referencedEntity === parentEntity.name) return false;
                return true;
            })
            .forEach(attr => {
                const normalizedName = this.toCamelCase(attr.name);
                const fieldName = normalizedName + 'Id';
                const cap = this.capitalize(fieldName);
                methods.getters.push(`get${cap}`);
                methods.setters.push(`set${cap}`);
            });
        return { getters: methods.getters, setters: methods.setters };
    }

    predictMapperMethods(entity) {
        return {
            methods: [
                'toDTO',
                'toEntity',
                'updateEntityFromDTO',
                'toDTOList',
                'toEntityList'
            ]
        };
    }

    predictServiceMethods(entity) {
        const methods = [
            'findAll',
            'findById',
            'create',
            'update',
            'partialUpdate',
            'delete',
            'existsById',
            'count'
        ];
        
        entity.attributes
            .filter(attr => !attr.isPrimaryKey && !attr.isRelationshipAttribute && !attr.isForeignKey)
            .forEach(attr => {
                const capName = this.capitalize(attr.name);
                methods.push(`findBy${capName}`);
                methods.push(`existsBy${capName}`);
            });
        entity.attributes
            .filter(attr => attr.isForeignKey && attr.referencedEntity)
            .forEach(attr => {
                const normalizedFieldName = this.toCamelCase(attr.name);
                const capFieldName = this.capitalize(normalizedFieldName);
                methods.push(`findBy${capFieldName}`);
                methods.push(`findBy${capFieldName}Id`);
                methods.push(`countBy${capFieldName}`);
            });
        return { methods };
    }

    predictRepositoryMethods(entity) {
        const methods = [
            'findAll',
            'findById',
            'save',
            'deleteById',
            'existsById',
            'count',
            'flush',
            'saveAndFlush'
        ];
        entity.attributes
            .filter(attr => !attr.isPrimaryKey && !attr.isRelationshipAttribute && !attr.isForeignKey)
            .forEach(attr => {
                const capName = this.capitalize(attr.name);
                methods.push(`findBy${capName}`);
                methods.push(`existsBy${capName}`);
                methods.push(`deleteBy${capName}`);
                methods.push(`countBy${capName}`);
            });
        entity.attributes
            .filter(attr => attr.isForeignKey && attr.referencedEntity)
            .forEach(attr => {
                const normalizedFieldName = this.toCamelCase(attr.name);
                const capFieldName = this.capitalize(normalizedFieldName);
                methods.push(`findBy${capFieldName}`);
                methods.push(`findBy${capFieldName}Id`);
                methods.push(`existsBy${capFieldName}`);
                methods.push(`deleteBy${capFieldName}`);
                methods.push(`countBy${capFieldName}`);
            });
        return { methods };
    }

    predictControllerMethods(entity) {
        const methods = [
            'findAll',
            'findById',
            'create',
            'update',
            'partialUpdate',
            'delete'
        ];
        entity.attributes
            .filter(attr => !attr.isPrimaryKey && !attr.isRelationshipAttribute && !attr.isForeignKey)
            .forEach(attr => {
                const capName = this.capitalize(attr.name);
                methods.push(`findBy${capName}`);
            });
        const fkAttrs = entity.attributes.filter(attr => 
            attr.isForeignKey && attr.referencedEntity
        );
        fkAttrs.forEach(attr => {
            methods.push(`get${this.capitalize(attr.name)}`);
            methods.push(`findBy${this.capitalize(attr.name)}`);
        });
        
        this.nombresColeccionesInversas(entity).forEach(fieldName => {
            methods.push(`get${this.capitalize(fieldName)}`);
        });
        return { methods };
    }

    /** Colecciones @OneToMany con los mismos nombres que EntityGenerator.getColeccionesInversas */
    nombresColeccionesInversas(entity) {
        const nombres = [];
        this.entities.forEach(otra => {
            const heredan = otra.id !== entity.id && this.relationships.some(rel =>
                rel.type === 'inheritance' &&
                ((rel.source === otra.id && rel.target === entity.id) || (rel.source === entity.id && rel.target === otra.id))
            );
            if (heredan) return;
            const fks = otra.attributes.filter(attr => attr.isForeignKey && attr.referencedEntity === entity.name);
            const base = this.toCamelCase(otra.name) + 's';
            fks.forEach(fk => nombres.push(fks.length > 1 ? base + this.capitalize(this.toCamelCase(fk.name)) : base));
        });
        return nombres;
    }

    getManyToOneRelationships(entity) {
        return entity.attributes
            .filter(attr => attr.isForeignKey && attr.referencedEntity)
            .map(attr => {
                const relatedEntity = this.entities.find(e => e.name === attr.referencedEntity);
                return {
                    fieldName: attr.name,
                    relatedEntity: relatedEntity
                };
            })
            .filter(rel => rel.relatedEntity);
    }

    getOneToManyRelationships(entity) {
        const results = [];
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
                        results.push({
                            relatedEntity: sourceEntity,
                            relationship: rel
                        });
                    }
                }
            }
            if (isSource) {
                const targetEntity = this.entities.find(e => e.id === rel.target);
                if (targetEntity) {
                    const targetHasFKToThis = targetEntity.attributes.some(attr =>
                        attr.isForeignKey && attr.referencedEntity === entity.name
                    );
                    const sourceMultiplicity = rel.sourceMultiplicity;
                    const isSourceMany = sourceMultiplicity && sourceMultiplicity.includes('*');
                    if (targetHasFKToThis && isSourceMany) {
                        results.push({
                            relatedEntity: targetEntity,
                            relationship: rel
                        });
                    }
                }
            }
        });
        return results;
    }

    getManyToManyRelationships(entity) {
        const results = [];
        this.relationships.forEach(rel => {
            if (rel.type === 'inheritance' || rel.type === 'implementation') return;
            const sourceMultiplicity = rel.sourceMultiplicity || '';
            const targetMultiplicity = rel.targetMultiplicity || '';
            const isManyToMany = sourceMultiplicity.includes('*') && targetMultiplicity.includes('*');
            if (!isManyToMany) return;
            if (rel.source === entity.id) {
                const relatedEntity = this.entities.find(e => e.id === rel.target);
                if (relatedEntity) {
                    results.push({
                        relatedEntity,
                        relationship: rel,
                        isOwner: true
                    });
                }
            }
            if (rel.target === entity.id) {
                const relatedEntity = this.entities.find(e => e.id === rel.source);
                if (relatedEntity) {
                    results.push({
                        relatedEntity,
                        relationship: rel,
                        isOwner: false
                    });
                }
            }
        });
        return results;
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

    getParentEntity(entityId) {
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

    getPrimaryKey(entity) {
        let pkAttr = entity.attributes.find(attr => attr.isPrimaryKey);
        if (!pkAttr) {
            const parentEntity = this.getParentEntity(entity.id);
            if (parentEntity) {
                pkAttr = parentEntity.attributes.find(attr => attr.isPrimaryKey);
            }
        }
        if (!pkAttr) {
            return {
                name: 'id',
                javaType: 'Long'
            };
        }
        
        // Si el PK es también FK (herencia JOINED), usar el campo referenciado
        const pkName = (pkAttr.isForeignKey && pkAttr.referencedField) ? pkAttr.referencedField : pkAttr.name;
        
        return {
            name: pkName,
            javaType: this.mapTypeToJava(pkAttr.type)
        };
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

export default MetadataBuilder;
