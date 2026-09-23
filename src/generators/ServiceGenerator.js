import { atributosListado, generarConsulta } from './ListadoGenerator.js';
import { muchosAMuchosEditables } from './Permisos.js';

// PUT reemplaza incluso con null; PATCH conserva los campos no enviados.
// Se emite cada rama directamente para admitir cualquier identificador Java, incluidas tildes.
const asignarCampoActualizado = (campo, modo) => modo === 'reemplazar'
    ? `        existing.set${campo}(updated.get${campo}());\n`
    : `        if (updated.get${campo}() != null) {
            existing.set${campo}(updated.get${campo}());
        }
`;

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

class ServiceGenerator {
    constructor(entities, relationships, metadata, politica = null) {
        this.entities = entities;
        this.relationships = relationships || [];
        this.metadata = metadata;
        this.conPermisos = politica?.explicito === true;
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
     * Mismo criterio que EntityGenerator, DTOGenerator y MapperGenerator.
     */
    getMuchosAMuchosPropios(entity) {
        return muchosAMuchosEditables(entity, this.entities, this.relationships).map(r => r.otra);
    }

    generateAll() {
        const services = [];
        this.entities.forEach(entity => {
            services.push({
                name: `${entity.name}Service.java`,
                content: this.generateServiceInterface(entity)
            });
            services.push({
                name: `${entity.name}ServiceImpl.java`,
                content: this.generateServiceImplementation(entity)
            });
        });
        return services;
    }

    generateServiceInterface(entity) {
        const pkType = this.getPrimaryKeyType(entity);
        const isCompositeKey = this.isCompositeKey(entity);
        const customSearchMethods = this.generateCustomSearchMethods(entity);
        const relatedEntities = new Set();
        atributosListado(entity, this.entities, this.relationships)
            .filter(attr => attr.isForeignKey && attr.referencedEntity)
            .forEach(attr => relatedEntities.add(attr.referencedEntity));
        const relatedImports = Array.from(relatedEntities)
            .map(entityName => `import com.example.demo.entities.${entityName};`)
            .join('\n');
        return `package com.example.demo.services;

import com.example.demo.entities.${entity.name};
${relatedImports}
${importsDeTipos(entity)}import java.util.List;
import java.util.Optional;

/**
 * Interfaz de servicio para ${entity.name}
 * Define las operaciones de negocio disponibles
 */
public interface ${entity.name}Service {

    // ========================================
    // CRUD BÁSICO
    // ========================================

    /**
     * Obtener todos los registros
     */
    List<${entity.name}> findAll();

    /** Sin página ni tamaño conserva el listado completo. Los filtros se combinan con AND. */
    org.springframework.data.domain.Page<${entity.name}> buscar(
        Integer pagina, Integer tamano, String texto, String orden, java.util.Map<String, String> filtros);

    /**
     * Buscar por ID
     */
    Optional<${entity.name}> findById(${pkType} id);

    /**
     * Crear nuevo registro
     */
    ${entity.name} create(${entity.name} entity);

    /**
     * Actualizar registro existente
     */
    ${entity.name} update(${pkType} id, ${entity.name} entity);

    /**
     * Actualizar parcialmente un registro
     */
    ${entity.name} partialUpdate(${pkType} id, ${entity.name} entity);

    /**
     * Eliminar registro
     */
    void delete(${pkType} id);

    /**
     * Verificar si existe
     */
    boolean existsById(${pkType} id);

    /**
     * Contar total de registros
     */
    long count();

${customSearchMethods}
}
`;
    }

    generateCustomSearchMethods(entity) {
        let methods = `    // ========================================
    // MÉTODOS DE BÚSQUEDA PERSONALIZADOS
    // ========================================\n`;

        const parentEntity = this.getParentEntity(entity.id);
        const parentAttrNames = parentEntity ? parentEntity.attributes.map(a => a.name) : [];

        entity.attributes
            .filter(attr => !attr.isPrimaryKey && !attr.isRelationshipAttribute && !attr.isForeignKey)
            .filter(attr => !parentAttrNames.includes(attr.name)) // Excluir atributos del padre
            .slice(0, 3)
            .forEach(attr => {
                const javaType = this.mapTypeToJava(attr.type);
                const normalizedName = this.toCamelCase(attr.name);
                const capName = this.capitalize(normalizedName);
                // List y no Optional: el campo no es único
                methods += `    /**
     * Buscar todos por ${normalizedName}
     */
    List<${entity.name}> findBy${capName}(${javaType} ${normalizedName});

    /**
     * Verificar si existe por ${normalizedName}
     */
    boolean existsBy${capName}(${javaType} ${normalizedName});

`;
            });

        // Usar la variable parentEntity ya declarada arriba
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
     * Contar por ${attr.referencedEntity}
     */
    long countBy${capFieldName}(${attr.referencedEntity} ${normalizedFieldName});

`;
            });
        return methods;
    }

    generateServiceImplementation(entity) {
        const seguro = this.conPermisos;
        const inversas = muchosAMuchosEditables(entity, this.entities, this.relationships).filter(r => !r.propietaria);
        const sincronizar = seguro && inversas.length > 0;
        const exigir = accion => `this.autorizacion.comprobar("${entity.name}", "${accion}", existing);`;
        const pkType = this.getPrimaryKeyType(entity);
        const pkName = this.getPrimaryKeyName(entity);
        const relatedEntities = new Set();
        atributosListado(entity, this.entities, this.relationships)
            .filter(attr => attr.isForeignKey && attr.referencedEntity)
            .forEach(attr => relatedEntities.add(attr.referencedEntity));
        // El servicio necesita el repositorio del otro lado de cada muchos a muchos
        this.getMuchosAMuchosPropios(entity).forEach(otra => relatedEntities.add(otra.name));
        const relatedImports = Array.from(relatedEntities)
            .map(entityName => `import com.example.demo.entities.${entityName};`)
            .join('\n');
        const relatedRepositoryImports = Array.from(relatedEntities)
            .map(entityName => `import com.example.demo.repositories.${entityName}Repository;`)
            .join('\n');
        const relatedRepositoryFields = Array.from(relatedEntities)
            .map(entityName => `    private final ${entityName}Repository ${this.toCamelCase(entityName)}Repository;`)
            .join('\n');
        const constructorParams = ['        ' + entity.name + 'Repository repository']
            .concat(seguro ? ['        com.example.demo.config.Autorizacion autorizacion'] : [])
            .concat(Array.from(relatedEntities).map(entityName =>
                `        ${entityName}Repository ${this.toCamelCase(entityName)}Repository`
            ))
            .join(',\n');
        const constructorAssignments = ['        this.repository = repository;']
            .concat(seguro ? ['        this.autorizacion = autorizacion;'] : [])
            .concat(Array.from(relatedEntities).map(entityName => {
                const repoName = this.toCamelCase(entityName) + 'Repository';
                return `        this.${repoName} = ${repoName};`;
            }))
            .join('\n');
        return `package com.example.demo.services;

import com.example.demo.entities.${entity.name};
${relatedImports}
import com.example.demo.exceptions.RecursoNoEncontradoException;
import com.example.demo.repositories.${entity.name}Repository;
${relatedRepositoryImports}
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
${importsDeTipos(entity)}import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Implementación del servicio para ${entity.name}
 * Contiene la lógica de negocio
 */
@Service
@Transactional
public class ${entity.name}ServiceImpl implements ${entity.name}Service {

    private final ${entity.name}Repository repository;
${seguro ? '    private final com.example.demo.config.Autorizacion autorizacion;' : ''}
${relatedRepositoryFields}

    @Autowired
    public ${entity.name}ServiceImpl(
${constructorParams}) {
${constructorAssignments}
    }

    @Override
    @Transactional(readOnly = true)
    public List<${entity.name}> findAll() {
        return repository.findAll(${seguro ? `this.autorizacion.alcance("${entity.name}", "ver")` : ''});
    }

${generarConsulta(entity, this.entities, this.relationships, nombre => this.toCamelCase(nombre), seguro)}

    @Override
    @Transactional(readOnly = true)
    public Optional<${entity.name}> findById(${pkType} id) {
${seguro ? `        this.autorizacion.alcance("${entity.name}", "ver");
        return repository.findById(id).map(existing -> { ${exigir('ver')} return existing; });` : '        return repository.findById(id);'}
    }

    @Override
    public ${entity.name} create(${entity.name} entity) {
        // Validaciones de negocio antes de crear
        validateEntity(entity);

        // CRÍTICO: Resolver relaciones FK antes de guardar
        resolveForeignKeys(entity);
${seguro ? `        if (entity.get${this.capitalize(this.toCamelCase(pkName))}() != null && repository.existsById(entity.get${this.capitalize(this.toCamelCase(pkName))}()))
            throw new IllegalArgumentException("Ya existe un registro con ese identificador.");
        this.autorizacion.comprobarRelaciones(entity, java.util.Map.of());
        this.autorizacion.comprobar("${entity.name}", "crear", entity);` : ''}
${sincronizar ? `        ${entity.name} created = repository.save(entity);
        sincronizarInversas(created, java.util.Map.of());
        return created;` : '        return repository.save(entity);'}
    }

    @Override
    public ${entity.name} update(${pkType} id, ${entity.name} entity) {
        return repository.findById(id)
            .map(existing -> {
${seguro ? `                ${exigir('editar')}
                var relacionesAntes = this.autorizacion.relaciones(existing);` : ''}
${sincronizar ? '                var inversasAntes = capturarInversas(existing);' : ''}
                // Actualizar campos
                reemplazarCampos(existing, entity);

                // CRÍTICO: Resolver relaciones FK antes de guardar
                resolveForeignKeys(existing);
${seguro ? `                this.autorizacion.comprobarRelaciones(existing, relacionesAntes);
                ${exigir('editar')}` : ''}
${sincronizar ? '                sincronizarInversas(existing, inversasAntes);' : ''}
                return repository.save(existing);
            })
            .orElseThrow(() -> new RecursoNoEncontradoException("${entity.name} con ID " + id + " no encontrado"));
    }

    @Override
    public ${entity.name} partialUpdate(${pkType} id, ${entity.name} entity) {
        return repository.findById(id)
            .map(existing -> {
${seguro ? `                ${exigir('editar')}
                var relacionesAntes = this.autorizacion.relaciones(existing);` : ''}
${sincronizar ? '                var inversasAntes = capturarInversas(existing);' : ''}
                // Actualizar solo los campos no nulos
                combinarCampos(existing, entity);

                // CRÍTICO: Resolver relaciones FK antes de guardar
                resolveForeignKeys(existing);
${seguro ? `                this.autorizacion.comprobarRelaciones(existing, relacionesAntes);
                ${exigir('editar')}` : ''}
${sincronizar ? '                sincronizarInversas(existing, inversasAntes);' : ''}
                return repository.save(existing);
            })
            .orElseThrow(() -> new RecursoNoEncontradoException("${entity.name} con ID " + id + " no encontrado"));
    }

    @Override
    public void delete(${pkType} id) {
${seguro ? `        var existing = repository.findById(id).orElseThrow(() -> new RecursoNoEncontradoException("Registro no encontrado"));
        this.autorizacion.comprobarBorrado("${entity.name}", existing);` : ''}
${sincronizar ? `        var relacionesAntes = this.autorizacion.relaciones(existing);
        var inversasAntes = capturarInversas(existing);
${inversas.map(r => `        existing.set${this.capitalize(r.propiedad)}(new ArrayList<>());`).join('\n')}
        this.autorizacion.comprobarRelaciones(existing, relacionesAntes);
        sincronizarInversas(existing, inversasAntes);` : ''}
        if (!repository.existsById(id)) {
            throw new RecursoNoEncontradoException("${entity.name} con ID " + id + " no encontrado");
        }
        repository.deleteById(id);
    }

    @Override
    @Transactional(readOnly = true)
    public boolean existsById(${pkType} id) {
        return ${seguro ? `repository.exists(this.autorizacion.<${entity.name}>alcance("${entity.name}", "ver").and((raiz, consulta, cb) -> cb.equal(raiz.get("${this.toCamelCase(pkName)}"), id)))` : 'repository.existsById(id)'};
    }

    @Override
    @Transactional(readOnly = true)
    public long count() {
        return repository.count(${seguro ? `this.autorizacion.alcance("${entity.name}", "ver")` : ''});
    }

${this.generateCustomSearchImplementations(entity)}

    /**
     * Validar entidad antes de persistir
     */
    private void validateEntity(${entity.name} entity) {
        if (entity == null) {
            throw new IllegalArgumentException("La entidad no puede ser nula");
        }
        // Las validaciones de campos se manejan con @Valid en el Controller
    }

    /**
     * Resolver relaciones de Foreign Keys
     * CRÍTICO: Este método busca las entidades relacionadas por ID en la BD
     */
    private void resolveForeignKeys(${entity.name} entity) {
${this.generateFKResolutionLogic(entity)}
    }

    /**
     * Actualizar campos de la entidad existente
     */
    // PUT reemplaza; PATCH conserva los campos no enviados.
    private void reemplazarCampos(${entity.name} existing, ${entity.name} updated) {
${this.generateUpdateFieldsLogic(entity, { modo: 'reemplazar' })}
    }

    private void combinarCampos(${entity.name} existing, ${entity.name} updated) {
${this.generateUpdateFieldsLogic(entity, { modo: 'combinar' })}
    }
${sincronizar ? this.generateSincronizarInversas(entity, inversas) : ''}
}
`;
    }

    generateSincronizarInversas(entity, inversas) {
        const getterId = 'get' + this.capitalize(this.toCamelCase(this.getPrimaryKeyName(entity)));
        return `
    /** Guarda los vínculos anteriores antes de reemplazar las colecciones del DTO. */
    private java.util.Map<String, List<?>> capturarInversas(${entity.name} entity) {
        java.util.Map<String, List<?>> resultado = new java.util.HashMap<>();
${inversas.map(r => `        resultado.put("${r.propiedad}", entity.get${this.capitalize(r.propiedad)}() == null ? List.of() : new ArrayList<>(entity.get${this.capitalize(r.propiedad)}()));`).join('\n')}
        return resultado;
    }

    /**
     * La política autoriza el registro y las relaciones antes de llegar aquí.
     * Solo cambia el enlace de este registro en el lado propietario; sus campos
     * escalares se conservan. Todos los objetos están gestionados en la misma
     * transacción, por lo que una denegación revierte también estas asociaciones.
     */
    private void sincronizarInversas(${entity.name} entity, java.util.Map<String, List<?>> anteriores) {
${inversas.map(r => {
            const otra = r.otra;
            const getterOtraId = 'get' + this.capitalize(this.toCamelCase(this.getPrimaryKeyName(otra)));
            const cap = this.capitalize(r.propiedad);
            const owner = this.capitalize(r.propiedadPropietaria);
            const variable = this.toCamelCase(otra.name);
            return `        List<${otra.name}> ${variable}Actuales = entity.get${cap}() == null ? List.of() : entity.get${cap}();
        for (Object previo : anteriores.getOrDefault("${r.propiedad}", List.of())) {
            ${otra.name} anterior = (${otra.name}) previo;
            boolean conserva = ${variable}Actuales.stream().anyMatch(actual -> java.util.Objects.equals(actual.${getterOtraId}(), anterior.${getterOtraId}()));
            if (!conserva && anterior.get${owner}() != null) {
                anterior.get${owner}().removeIf(vinculado -> java.util.Objects.equals(vinculado.${getterId}(), entity.${getterId}()));
            }
        }
        for (${otra.name} actual : ${variable}Actuales) {
            if (actual.get${owner}() == null) actual.set${owner}(new ArrayList<>());
            boolean existe = actual.get${owner}().stream().anyMatch(vinculado -> java.util.Objects.equals(vinculado.${getterId}(), entity.${getterId}()));
            if (!existe) actual.get${owner}().add(entity);
        }
`;
        }).join('\n')}
    }
`;
    }

    generateUpdateFieldsLogic(entity, { modo = 'combinar' } = {}) {
        let updates = '';
        const entityMeta = this.metadata ? this.metadata.get(entity.name) : null;
        if (!entityMeta) {
            console.warn(`⚠️  No se encontró metadata para ${entity.name}, usando modo fallback`);
        }
        entity.attributes
            .filter(attr => !attr.isPrimaryKey && !attr.isRelationshipAttribute && !attr.isForeignKey)
            .forEach(attr => {
                const normalizedName = this.toCamelCase(attr.name);
                const capitalizedName = this.capitalize(normalizedName);
                if (entityMeta && entityMeta.entity) {
                    const hasGetter = entityMeta.entity.getters.includes(`get${capitalizedName}`);
                    const hasSetter = entityMeta.entity.setters.includes(`set${capitalizedName}`);
                    if (hasGetter && hasSetter) {
                        updates += asignarCampoActualizado(capitalizedName, modo);
                    } else {
                        console.warn(`⚠️  ${entity.name}.Entity: Métodos get${capitalizedName}/set${capitalizedName} no encontrados`);
                        console.warn(`   SALTANDO actualización del atributo '${normalizedName}'`);
                    }
                } else {
                    updates += asignarCampoActualizado(capitalizedName, modo);
                }
            });
        const parentEntity = this.getParentEntity(entity.id);
        const fkAttributes = entity.attributes.filter(attr => {
            if (!attr.isForeignKey || !attr.referencedEntity) return false;
            if (parentEntity && attr.referencedEntity === parentEntity.name) return false;
            return true;
        });
        if (fkAttributes.length > 0) {
            updates += `\n        // Actualizar Foreign Keys\n`;
            fkAttributes.forEach(attr => {
                const normalizedName = this.toCamelCase(attr.name);
                const capitalizedName = this.capitalize(normalizedName);
                if (entityMeta && entityMeta.entity) {
                    const hasGetter = entityMeta.entity.getters.includes(`get${capitalizedName}`);
                    const hasSetter = entityMeta.entity.setters.includes(`set${capitalizedName}`);
                    if (hasGetter && hasSetter) {
                        updates += `        // FK: ${normalizedName}\n` + asignarCampoActualizado(capitalizedName, modo);
                    } else {
                        console.warn(`⚠️  ${entity.name}.Entity FK: Métodos get${capitalizedName}/set${capitalizedName} no encontrados`);
                        console.warn(`   Available getters: ${entityMeta.entity.getters.join(', ')}`);
                        console.warn(`   Available setters: ${entityMeta.entity.setters.join(', ')}`);
                        console.warn(`   SALTANDO actualización del FK '${normalizedName}'`);
                    }
                } else {
                    updates += `        // FK: ${normalizedName}\n` + asignarCampoActualizado(capitalizedName, modo);
                }
            });
        }
        updates += this.generateActualizarHeredados(entity, { modo });
        this.getMuchosAMuchosPropios(entity).forEach(otra => {
            const coleccion = this.capitalize(this.toCamelCase(otra.name) + 's');
            updates += `        // Muchos a muchos: ${otra.name}\n` + asignarCampoActualizado(coleccion, modo);
        });
        return updates;
    }

    /**
     * Campos heredados de una entidad hija: su metadata solo lista los propios y un
     * PUT no actualizaba los atributos definidos en el padre.
     */
    generateActualizarHeredados(entity, { modo = 'combinar' } = {}) {
        let updates = '';
        const propios = new Set(entity.attributes.map(a => a.name));
        const vistos = new Set();
        for (let padre = this.isChildInInheritance(entity.id) ? this.getParentEntity(entity.id) : null;
            padre && !vistos.has(padre.id);
            padre = this.isChildInInheritance(padre.id) ? this.getParentEntity(padre.id) : null) {
            vistos.add(padre.id);
            padre.attributes
                .filter(attr => !attr.isPrimaryKey && !attr.isRelationshipAttribute && !propios.has(attr.name))
                .forEach(attr => {
                    propios.add(attr.name);
                    const cap = this.capitalize(this.toCamelCase(attr.name));
                    updates += `        // Heredado de ${padre.name}\n` + asignarCampoActualizado(cap, modo);
                });
        }
        return updates;
    }

    generateFKResolutionLogic(entity) {
        let logic = '';
        // Incluye todos los ancestros y descarta sus FK técnicas de herencia.
        const fkAttributes = atributosListado(entity, this.entities, this.relationships)
            .filter(attr => attr.isForeignKey && attr.referencedEntity);
        const muchosAMuchos = this.getMuchosAMuchosPropios(entity);
        if (fkAttributes.length === 0 && muchosAMuchos.length === 0) {
            logic = '        // No hay FKs que resolver\n';
            return logic;
        }
        const metadatos = [];
        const visitadas = new Set();
        for (let declaradora = entity; declaradora && !visitadas.has(declaradora.id);
            declaradora = this.getParentEntity(declaradora.id)) {
            visitadas.add(declaradora.id);
            const meta = this.metadata?.get(declaradora.name)?.entity;
            if (meta) metadatos.push(meta);
        }
        fkAttributes.forEach(attr => {
            const normalizedName = this.toCamelCase(attr.name);
            const capitalizedName = this.capitalize(normalizedName);
            const referencedEntity = attr.referencedEntity;
            const repoName = this.toCamelCase(referencedEntity) + 'Repository';
            const refEntity = this.entities.find(e => e.name === referencedEntity);
            const pkType = refEntity ? this.getPrimaryKeyType(refEntity) : 'Long';
            const pkName = refEntity ? this.getPrimaryKeyName(refEntity) : 'id';
            const normalizedPkName = this.toCamelCase(pkName);
            const capitalizedPkName = this.capitalize(normalizedPkName);
            if (metadatos.length) {
                const hasGetter = metadatos.some(meta => meta.getters.includes(`get${capitalizedName}`));
                const hasSetter = metadatos.some(meta => meta.setters.includes(`set${capitalizedName}`));
                if (!hasGetter || !hasSetter) {
                    console.warn(`⚠️  ${entity.name}.Entity: Métodos get${capitalizedName}/set${capitalizedName} no encontrados para FK`);
                    console.warn(`   SALTANDO resolución de FK '${normalizedName}'`);
                    return;
                }
            }
            logic += `        // Resolver FK: ${normalizedName} -> ${referencedEntity}
        if (entity.get${capitalizedName}() != null) {
            ${referencedEntity} ${normalizedName}Ref = entity.get${capitalizedName}();

            // Si el objeto FK tiene un ID válido, buscar la entidad completa
            if (${normalizedName}Ref.get${capitalizedPkName}() != null) {
                ${pkType} ${normalizedName}Id = ${normalizedName}Ref.get${capitalizedPkName}();

                // Buscar en base de datos
                ${referencedEntity} ${normalizedName}Entity = ${repoName}.findById(${normalizedName}Id)
                    .orElseThrow(() -> new RecursoNoEncontradoException("${referencedEntity} con ID " + ${normalizedName}Id + " no encontrado"));

                // Asignar la entidad completa cargada desde BD
                entity.set${capitalizedName}(${normalizedName}Entity);
            } else {
                // Si no tiene ID, establecer como null
                entity.set${capitalizedName}(null);
            }
        }
`;
        });
        muchosAMuchos.forEach(otra => {
            const variable = this.toCamelCase(otra.name);
            const coleccion = this.capitalize(variable + 's');
            const repoName = variable + 'Repository';
            const pkType = this.getPrimaryKeyType(otra);
            const pkGetter = 'get' + this.capitalize(this.toCamelCase(this.getPrimaryKeyName(otra)));
            logic += `        // Resolver muchos a muchos: ${otra.name} (cargar las entidades reales por ID)
        if (entity.get${coleccion}() != null && !entity.get${coleccion}().isEmpty()) {
            List<${pkType}> ${variable}Ids = entity.get${coleccion}().stream()
                .map(${otra.name}::${pkGetter})
                .distinct()
                .collect(Collectors.toList());
            List<${otra.name}> ${variable}Encontrados = ${repoName}.findAllById(${variable}Ids);
            if (${variable}Encontrados.size() != ${variable}Ids.size()) {
                throw new RecursoNoEncontradoException("Algún ${otra.name} no existe entre los IDs " + ${variable}Ids);
            }
            entity.set${coleccion}(new ArrayList<>(${variable}Encontrados));
        }
`;
        });
        return logic;
    }

    generateCustomSearchImplementations(entity) {
        let implementations = `    // ========================================
    // IMPLEMENTACIÓN DE BÚSQUEDAS PERSONALIZADAS
    // ========================================\n\n`;

        const parentEntity = this.getParentEntity(entity.id);
        const parentAttrNames = parentEntity ? parentEntity.attributes.map(a => a.name) : [];

        entity.attributes
            .filter(attr => !attr.isPrimaryKey && !attr.isRelationshipAttribute && !attr.isForeignKey)
            .filter(attr => !parentAttrNames.includes(attr.name)) // Excluir atributos del padre
            .slice(0, 3)
            .forEach(attr => {
                const javaType = this.mapTypeToJava(attr.type);
                const normalizedName = this.toCamelCase(attr.name);
                const capName = this.capitalize(normalizedName);
                implementations += `    @Override
    @Transactional(readOnly = true)
    public List<${entity.name}> findBy${capName}(${javaType} ${normalizedName}) {
        return ${this.conPermisos ? `repository.findAll(this.autorizacion.<${entity.name}>alcance("${entity.name}", "ver").and((raiz, consulta, cb) -> cb.equal(raiz.get("${normalizedName}"), ${normalizedName})))` : `repository.findBy${capName}(${normalizedName})`};
    }

    @Override
    @Transactional(readOnly = true)
    public boolean existsBy${capName}(${javaType} ${normalizedName}) {
        return ${this.conPermisos ? `repository.exists(this.autorizacion.<${entity.name}>alcance("${entity.name}", "ver").and((raiz, consulta, cb) -> cb.equal(raiz.get("${normalizedName}"), ${normalizedName})))` : `repository.existsBy${capName}(${normalizedName})`};
    }

`;
            });

        // Usar la variable parentEntity ya declarada arriba
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
                implementations += `    @Override
    @Transactional(readOnly = true)
    public List<${entity.name}> findBy${capFieldName}(${attr.referencedEntity} ${normalizedFieldName}) {
        return ${this.conPermisos ? `repository.findAll(this.autorizacion.<${entity.name}>alcance("${entity.name}", "ver").and((raiz, consulta, cb) -> cb.equal(raiz.get("${normalizedFieldName}"), ${normalizedFieldName})))` : `repository.findBy${capFieldName}(${normalizedFieldName})`};
    }

    @Override
    @Transactional(readOnly = true)
    public List<${entity.name}> findBy${capFieldName}${capPkName}(${pkType} ${normalizedFieldName}${capPkName}) {
        return ${this.conPermisos ? `repository.findAll(this.autorizacion.<${entity.name}>alcance("${entity.name}", "ver").and((raiz, consulta, cb) -> cb.equal(raiz.get("${normalizedFieldName}").get("${normalizedPkName}"), ${normalizedFieldName}${capPkName})))` : `repository.findBy${capFieldName}${capPkName}(${normalizedFieldName}${capPkName})`};
    }

    @Override
    @Transactional(readOnly = true)
    public long countBy${capFieldName}(${attr.referencedEntity} ${normalizedFieldName}) {
        return ${this.conPermisos ? `repository.count(this.autorizacion.<${entity.name}>alcance("${entity.name}", "ver").and((raiz, consulta, cb) -> cb.equal(raiz.get("${normalizedFieldName}"), ${normalizedFieldName})))` : `repository.countBy${capFieldName}(${normalizedFieldName})`};
    }

`;
            });
        return implementations;
    }

    getPrimaryKeyType(entity) {
        let pkAttr = entity.attributes.find(attr => attr.isPrimaryKey);
        if (!pkAttr) {
            const parentEntity = this.getParentEntity(entity.id);
            if (parentEntity) {
                pkAttr = parentEntity.attributes.find(attr => attr.isPrimaryKey);
            }
        }
        if (!pkAttr) return 'Long';
        return this.mapTypeToJava(pkAttr.type);
    }

    getPrimaryKeyName(entity) {
        let pkAttr = entity.attributes.find(attr => attr.isPrimaryKey);
        if (!pkAttr) {
            const parentEntity = this.getParentEntity(entity.id);
            if (parentEntity) {
                pkAttr = parentEntity.attributes.find(attr => attr.isPrimaryKey);
            }
        }
        if (!pkAttr) return 'id';

        // Si el PK es también FK (herencia JOINED), usar el campo referenciado
        if (pkAttr.isForeignKey && pkAttr.referencedField) {
            return pkAttr.referencedField;
        }
        return pkAttr.name;
    }

    isCompositeKey(entity) {
        let pkAttrs = entity.attributes.filter(attr => attr.isPrimaryKey);
        if (pkAttrs.length === 0) {
            const parentEntity = this.getParentEntity(entity.id);
            if (parentEntity) {
                pkAttrs = parentEntity.attributes.filter(attr => attr.isPrimaryKey);
            }
        }
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

export default ServiceGenerator;
