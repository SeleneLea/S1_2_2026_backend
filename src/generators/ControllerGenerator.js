class ControllerGenerator {
    constructor(entities, relationships, metadata) {
        this.entities = entities;
        this.relationships = relationships || [];
        this.metadata = metadata;
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

    getAllAttributes(entity) {
        const isChild = this.isChildInInheritance(entity.id);
        if (!isChild) {
            return entity.attributes;
        }
        const parentEntity = this.getParentEntity(entity.id);
        if (!parentEntity) {
            return entity.attributes;
        }
        return [...parentEntity.attributes, ...entity.attributes];
    }

    generateAll() {
        return this.entities.map(entity => ({
            name: `${entity.name}Controller.java`,
            content: this.generateController(entity)
        }));
    }

    generateController(entity) {
        const pkType = this.getPrimaryKeyType(entity);
        const entityPath = this.toKebabCase(entity.name);
        const relationshipEndpoints = this.generateRelationshipEndpoints(entity);
        const isCompositeKey = this.isCompositeKey(entity);
        return `package com.example.demo.controllers;

import com.example.demo.entities.*;
import com.example.demo.dto.${entity.name}DTO;
import com.example.demo.services.${entity.name}Service;
import com.example.demo.mappers.${entity.name}Mapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.example.demo.exceptions.RecursoNoEncontradoException;
import org.springframework.core.NestedExceptionUtils;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.TransactionSystemException;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Controlador REST para ${entity.name}
 * Endpoints CRUD estándar
 */
@RestController
@RequestMapping("/api/${entityPath}")
@CrossOrigin(origins = "*", maxAge = 3600)
public class ${entity.name}Controller {

    private final ${entity.name}Service service;
    private final ${entity.name}Mapper mapper;

    @Autowired
    public ${entity.name}Controller(${entity.name}Service service, ${entity.name}Mapper mapper) {
        this.service = service;
        this.mapper = mapper;
    }

    /**
     * GET /api/${entityPath}
     * Obtener todos los registros
     */
    @GetMapping
    public ResponseEntity<Map<String, Object>> getAll() {
        try {
            List<${entity.name}> entities = service.findAll();
            List<${entity.name}DTO> dtos = mapper.toDTOList(entities);
            
            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("data", dtos);
            response.put("total", dtos.size());
            response.put("message", dtos.isEmpty() ? "No hay registros disponibles" : "Registros obtenidos exitosamente");
            
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return handleError(e, "Error al obtener registros");
        }
    }

    /**
     * GET /api/${entityPath}/{id}
     * Obtener registro por ID
     */
    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> getById(@PathVariable ${pkType} id) {
        try {
            return service.findById(id)
                .map(entity -> {
                    ${entity.name}DTO dto = mapper.toDTO(entity);
                    Map<String, Object> response = new HashMap<>();
                    response.put("success", true);
                    response.put("data", dto);
                    return ResponseEntity.ok(response);
                })
                .orElseGet(() -> {
                    Map<String, Object> response = new HashMap<>();
                    response.put("success", false);
                    response.put("message", "${entity.name} no encontrado con ID: " + id);
                    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
                });
        } catch (Exception e) {
            return handleError(e, "Error al buscar registro");
        }
    }

    /**
     * POST /api/${entityPath}
     * Crear nuevo registro
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@Valid @RequestBody ${entity.name}DTO dto) {
        try {
            ${entity.name} entity = mapper.toEntity(dto);${this.getPrimaryKeySetter(entity) ? `
            // El ID lo asigna la base de datos: se ignora el que envíe el cliente
            entity.${this.getPrimaryKeySetter(entity)}(null);` : ''}
            ${entity.name} created = service.create(entity);
            ${entity.name}DTO createdDTO = mapper.toDTO(created);
            
            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("message", "${entity.name} creado exitosamente");
            response.put("data", createdDTO);
            
            return ResponseEntity.status(HttpStatus.CREATED).body(response);
        } catch (RecursoNoEncontradoException e) {
            return respuestaError(HttpStatus.NOT_FOUND, e.getMessage());
        } catch (DataIntegrityViolationException e) {
            return respuestaError(HttpStatus.CONFLICT, MENSAJE_INTEGRIDAD);
        } catch (IllegalArgumentException | ConstraintViolationException | TransactionSystemException e) {
            return respuestaError(HttpStatus.BAD_REQUEST, "Datos inválidos: " + causa(e));
        } catch (Exception e) {
            return handleError(e, "Error al crear registro");
        }
    }

    /**
     * PUT /api/${entityPath}/{id}
     * Actualizar registro existente
     */
    @PutMapping("/{id}")
    public ResponseEntity<Map<String, Object>> update(
            @PathVariable ${pkType} id,
            @Valid @RequestBody ${entity.name}DTO dto) {
        try {
            ${entity.name} entity = mapper.toEntity(dto);
            ${entity.name} updated = service.update(id, entity);
            ${entity.name}DTO updatedDTO = mapper.toDTO(updated);
            
            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("message", "${entity.name} actualizado exitosamente");
            response.put("data", updatedDTO);
            
            return ResponseEntity.ok(response);
        } catch (RecursoNoEncontradoException e) {
            return respuestaError(HttpStatus.NOT_FOUND, e.getMessage());
        } catch (DataIntegrityViolationException e) {
            return respuestaError(HttpStatus.CONFLICT, MENSAJE_INTEGRIDAD);
        } catch (IllegalArgumentException | ConstraintViolationException | TransactionSystemException e) {
            return respuestaError(HttpStatus.BAD_REQUEST, "Datos inválidos: " + causa(e));
        } catch (Exception e) {
            return handleError(e, "Error al actualizar registro");
        }
    }

    /**
     * PATCH /api/${entityPath}/{id}
     * Actualizar registro parcialmente (solo campos enviados)
     */
    @PatchMapping("/{id}")
    public ResponseEntity<Map<String, Object>> partialUpdate(
            @PathVariable ${pkType} id,
            @RequestBody ${entity.name}DTO dto) {
        try {
            ${entity.name} entity = mapper.toEntity(dto);
            ${entity.name} updated = service.partialUpdate(id, entity);
            ${entity.name}DTO updatedDTO = mapper.toDTO(updated);
            
            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("message", "${entity.name} actualizado parcialmente");
            response.put("data", updatedDTO);
            
            return ResponseEntity.ok(response);
        } catch (RecursoNoEncontradoException e) {
            return respuestaError(HttpStatus.NOT_FOUND, e.getMessage());
        } catch (DataIntegrityViolationException e) {
            return respuestaError(HttpStatus.CONFLICT, MENSAJE_INTEGRIDAD);
        } catch (IllegalArgumentException | ConstraintViolationException | TransactionSystemException e) {
            return respuestaError(HttpStatus.BAD_REQUEST, "Datos inválidos: " + causa(e));
        } catch (Exception e) {
            return handleError(e, "Error al actualizar registro parcialmente");
        }
    }

    /**
     * DELETE /api/${entityPath}/{id}
     * Eliminar registro
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> delete(@PathVariable ${pkType} id) {
        try {
            service.delete(id);
            
            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("message", "${entity.name} eliminado exitosamente");
            
            return ResponseEntity.ok(response);
        } catch (RecursoNoEncontradoException e) {
            return respuestaError(HttpStatus.NOT_FOUND, e.getMessage());
        } catch (DataIntegrityViolationException e) {
            return respuestaError(HttpStatus.CONFLICT, MENSAJE_INTEGRIDAD);
        } catch (IllegalArgumentException | ConstraintViolationException | TransactionSystemException e) {
            return respuestaError(HttpStatus.BAD_REQUEST, "Datos inválidos: " + causa(e));
        } catch (Exception e) {
            return handleError(e, "Error al eliminar registro");
        }
    }

    /**
     * GET /api/${entityPath}/count
     * Contar total de registros
     */
    @GetMapping("/count")
    public ResponseEntity<Map<String, Object>> count() {
        try {
            long total = service.count();
            
            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("total", total);
            response.put("message", "Total de registros: " + total);
            
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return handleError(e, "Error al contar registros");
        }
    }

    /**
     * GET /api/${entityPath}/exists/{id}
     * Verificar si existe un registro
     */
    @GetMapping("/exists/{id}")
    public ResponseEntity<Map<String, Object>> exists(@PathVariable ${pkType} id) {
        try {
            boolean exists = service.existsById(id);
            
            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("exists", exists);
            response.put("message", exists ? 
                "${entity.name} existe" : 
                "${entity.name} no existe");
            
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return handleError(e, "Error al verificar existencia");
        }
    }

    /**
     * DELETE /api/${entityPath}/batch
     * Eliminar múltiples registros
     */
    @DeleteMapping("/batch")
    public ResponseEntity<Map<String, Object>> deleteBatch(@RequestBody List<${pkType}> ids) {
        try {
            int deletedCount = 0;
            List<String> errors = new java.util.ArrayList<>();
            
            for (${pkType} id : ids) {
                try {
                    service.delete(id);
                    deletedCount++;
                } catch (Exception e) {
                    errors.add("Error eliminando ID " + id + ": " + e.getMessage());
                }
            }
            
            Map<String, Object> response = new HashMap<>();
            response.put("success", errors.isEmpty());
            response.put("message", deletedCount + " registros eliminados");
            response.put("deletedCount", deletedCount);
            response.put("totalRequested", ids.size());
            if (!errors.isEmpty()) {
                response.put("errors", errors);
            }
            
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return handleError(e, "Error en eliminación por lotes");
        }
    }

${relationshipEndpoints}

    /**
     * Manejo centralizado de errores
     */
    private static final String MENSAJE_INTEGRIDAD =
        "La base de datos rechazó la operación: el registro tiene datos relacionados o viola una restricción";

    /**
     * Respuesta de error del cliente (404, 409, 400) con el mismo formato que el resto
     */
    private ResponseEntity<Map<String, Object>> respuestaError(HttpStatus estado, String mensaje) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", false);
        response.put("message", mensaje);
        return ResponseEntity.status(estado).body(response);
    }

    /**
     * Mensaje de la causa más específica (las excepciones de transacción envuelven la real)
     */
    private String causa(Exception e) {
        return NestedExceptionUtils.getMostSpecificCause(e).getMessage();
    }

    private ResponseEntity<Map<String, Object>> handleError(Exception e, String message) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", false);
        response.put("message", message);
        response.put("error", e.getMessage());
        response.put("timestamp", java.time.LocalDateTime.now());
        
        System.err.println("Error en ${entity.name}Controller: " + message);
        e.printStackTrace();
        
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
    }
}
`;
    }

    generateRelationshipEndpoints(entity) {
        let endpoints = '';
        const entityPath = this.toKebabCase(entity.name);
        const pkType = this.getPrimaryKeyType(entity);
        const processedEndpoints = new Set();
        const allAttributes = this.getAllAttributes(entity);
        const parentEntity = this.getParentEntity(entity.id);
        const fkAttributes = allAttributes.filter(attr => {
            if (!attr.isForeignKey || !attr.referencedEntity) return false;
            if (parentEntity && attr.referencedEntity === parentEntity.name) {
                return false;
            }
            return true;
        });
        fkAttributes.forEach(attr => {
            const referencedEntity = this.entities.find(e => e.name === attr.referencedEntity);
            if (!referencedEntity) return;
            const normalizedName = this.toCamelCase(attr.name);
            const capitalizedFieldName = this.capitalize(normalizedName);
            // Ruta por el nombre del campo: con dos FK a la misma entidad (origen y
            // destino) la ruta por entidad se repetía; con una sola FK es la misma
            const relatedPath = this.toKebabCase(normalizedName);
            const endpointKey = `${entityPath}_${relatedPath}`;
            if (processedEndpoints.has(endpointKey)) return;
            processedEndpoints.add(endpointKey);
            const entityMeta = this.metadata ? this.metadata.get(entity.name) : null;
            const hasGetter = (entityMeta && entityMeta.entity) ?
                entityMeta.entity.getters.includes(`get${capitalizedFieldName}`) : false;
            if (!hasGetter) {
                console.warn(`⚠️  ${entity.name}.Entity: Método get${capitalizedFieldName}() no encontrado, omitiendo endpoint FK`);
                return;
            }
            if (endpoints === '') {
                endpoints = '\n    // Endpoints para relaciones (devuelven solo IDs)\n';
            }
            endpoints += `
    /**
     * GET /api/${entityPath}/{id}/${relatedPath}
     * Obtener ID de ${attr.referencedEntity} relacionado
     */
    @GetMapping("/{id}/${relatedPath}")
    public ResponseEntity<Map<String, Object>> get${capitalizedFieldName}(@PathVariable ${pkType} id) {
        try {
            return service.findById(id)
                .map(entity -> {
                    ${attr.referencedEntity} related = entity.get${capitalizedFieldName}();
                    Map<String, Object> response = new HashMap<>();
                    response.put("success", true);
                    if (related != null) {
                        Map<String, Object> relatedData = new HashMap<>();
                        relatedData.put("id", related.get${this.getIdGetter(referencedEntity)}());
                        response.put("data", relatedData);
                    } else {
                        response.put("data", null);
                    }
                    return ResponseEntity.ok(response);
                })
                .orElseGet(() -> {
                    Map<String, Object> response = new HashMap<>();
                    response.put("success", false);
                    response.put("message", "${entity.name} no encontrado con ID: " + id);
                    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(response);
                });
        } catch (Exception e) {
            return handleError(e, "Error al obtener ${attr.referencedEntity} relacionado");
        }
    }
`;
        });
        return endpoints;
    }

    /**
     * Setter de la clave primaria (p. ej. "setId"), o null si es compuesta o no hay.
     * Al crear se anula el ID que mande el cliente: con un ID que no existe,
     * save() intenta actualizar en lugar de insertar y la operación falla.
     */
    getPrimaryKeySetter(entity) {
        let pks = entity.attributes.filter(attr => attr.isPrimaryKey);
        if (pks.length === 0) {
            const parentEntity = this.getParentEntity(entity.id);
            if (parentEntity) pks = parentEntity.attributes.filter(attr => attr.isPrimaryKey);
        }
        if (pks.length !== 1) return null;
        const nombre = this.toCamelCase(pks[0].name);
        return `set${nombre.charAt(0).toUpperCase()}${nombre.slice(1)}`;
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

    isCompositeKey(entity) {
        const allAttrs = this.getAllAttributes(entity);
        const pkAttrs = allAttrs.filter(attr => attr.isPrimaryKey);
        return pkAttrs.length > 1;
    }

    generateFKResolutionCode(entity, dtoVar, entityVar) {
        let code = '';
        const fkAttributes = entity.attributes.filter(attr =>
            attr.isForeignKey && attr.referencedEntity
        );
        const entityMeta = this.metadata ? this.metadata.get(entity.name) : null;
        fkAttributes.forEach(attr => {
            const normalizedName = this.toCamelCase(attr.name);
            const capitalizedFieldName = this.capitalize(normalizedName);
            const dtoFieldName = normalizedName + 'Id';
            const capitalizedDtoFieldName = this.capitalize(dtoFieldName);
            const repoName = this.toCamelCase(attr.referencedEntity) + 'Repository';
            if (entityMeta && entityMeta.entity) {
                const hasSetter = entityMeta.entity.setters.includes(`set${capitalizedFieldName}`);
                if (!hasSetter) {
                    console.warn(`⚠️  ${entity.name}.Entity: Método set${capitalizedFieldName}() no encontrado`);
                    console.warn(`   Available setters: ${entityMeta.entity.setters.join(', ')}`);
                    console.warn(`   SALTANDO mapeo FK '${normalizedName}' en Controller`);
                    return;
                }
            }
            code += `            if (${dtoVar}.get${capitalizedDtoFieldName}() != null) {
                ${entityVar}.set${capitalizedFieldName}(
                    ${repoName}.findById(${dtoVar}.get${capitalizedDtoFieldName}())
                        .orElseThrow(() -> new RuntimeException("${attr.referencedEntity} con ID " + ${dtoVar}.get${capitalizedDtoFieldName}() + " no encontrado"))
                );
            }
`;
        });
        return code;
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

    getIdGetter(entity) {
        let pkAttr = entity.attributes.find(attr => attr.isPrimaryKey);
        if (!pkAttr) {
            // Buscar en el padre si es herencia
            const parentEntity = this.getParentEntity(entity.id);
            if (parentEntity) {
                return this.getIdGetter(parentEntity); // Recursivo
            }
            return 'Id';
        }
        
        // Si el PK es también FK (herencia JOINED), usar el campo referenciado
        const pkName = (pkAttr.isForeignKey && pkAttr.referencedField) ? pkAttr.referencedField : pkAttr.name;
        const normalizedName = this.toCamelCase(pkName);
        return this.capitalize(normalizedName);
    }

    toKebabCase(str) {
        return str
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .toLowerCase();
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
}

export default ControllerGenerator;