class ManyToManyEntityGenerator {
    constructor(manyToManyTables, entities) {
        this.manyToManyTables = manyToManyTables;
        this.entities = entities;
    }

    generateAll() {
        return this.manyToManyTables.map(table => ({
            name: `${table.name}.java`,
            content: this.generateManyToManyEntity(table)
        }));
    }

    generateManyToManyEntity(table) {
        const imports = this.generateImports(table);
        const classAnnotations = this.generateClassAnnotations(table);
        const compositeKeyClass = this.generateCompositeKeyClass(table);
        const fields = this.generateFields(table);
        const constructors = this.generateConstructors(table);
        const gettersSetters = this.generateGettersSetters(table);
        // Generate entity that uses @EmbeddedId with primitive id fields and @MapsId for relations
        return `package com.example.demo.entities;

${imports}

${classAnnotations}
public class ${table.name} {

    @EmbeddedId
    private ${table.name}Id id;

${fields}

${constructors}

${gettersSetters}

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ${table.name})) return false;
        ${table.name} that = (${table.name}) o;
        return Objects.equals(id, that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }

${compositeKeyClass}
}
`;
    }

    generateImports(table) {
        const imports = new Set([
            'import jakarta.persistence.*;',
            'import jakarta.validation.constraints.*;',
            'import java.util.Objects;',
            'import java.io.Serializable;',
            'import com.fasterxml.jackson.annotation.JsonIgnoreProperties;',
        ]);
        table.additionalAttributes.forEach(attr => {
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

    generateClassAnnotations(table) {
        return `@Entity
@Table(name = "${table.tableName}")`;
    }

    generateCompositeKeyClass(table) {
        // Generate an embeddable id class with primitive id fields (no entity references)
        let keyClass = `
    /**
     * Clase embebida para la clave compuesta
     */
    @Embeddable
    public static class ${table.name}Id implements Serializable {
        private static final long serialVersionUID = 1L;

`;
        // For each FK, try to find the original attribute to deduce type; fallback to Long
        table.foreignKeys.forEach(fk => {
            // try to find attribute in table.attributes matching columnName
            const attr = (table.attributes || []).find(a => this.toSnakeCase(a.name) === fk.columnName || a.referencedEntity === fk.referencedEntity);
            const javaType = attr ? this.mapTypeToJava(attr.type) : 'Long';
            const fieldName = this.toCamelCase(fk.referencedEntity) + 'Id';
            keyClass += `
        @Column(name = "${fk.columnName}")
        private ${javaType} ${fieldName};
`;
        });
        // default constructor
        keyClass += `
        public ${table.name}Id() {
        }

`;
        // constructor with params
        const params = table.foreignKeys.map(fk => {
            const attr = (table.attributes || []).find(a => this.toSnakeCase(a.name) === fk.columnName || a.referencedEntity === fk.referencedEntity);
            const javaType = attr ? this.mapTypeToJava(attr.type) : 'Long';
            const fieldName = this.toCamelCase(fk.referencedEntity) + 'Id';
            return `${javaType} ${fieldName}`;
        }).join(', ');

        keyClass += `        public ${table.name}Id(${params}) {
`;
        table.foreignKeys.forEach(fk => {
            const fieldName = this.toCamelCase(fk.referencedEntity) + 'Id';
            keyClass += `            this.${fieldName} = ${fieldName};\n`;
        });
        keyClass += `        }

`;
        // getters/setters
        table.foreignKeys.forEach(fk => {
            const attr = (table.attributes || []).find(a => this.toSnakeCase(a.name) === fk.columnName || a.referencedEntity === fk.referencedEntity);
            const javaType = attr ? this.mapTypeToJava(attr.type) : 'Long';
            const fieldName = this.toCamelCase(fk.referencedEntity) + 'Id';
            const capitalized = this.capitalize(fieldName);
            keyClass += `        public ${javaType} get${capitalized}() {\n            return ${fieldName};\n        }\n\n        public void set${capitalized}(${javaType} ${fieldName}) {\n            this.${fieldName} = ${fieldName};\n        }\n\n`;
        });

        // equals/hashCode
        const equalsComparison = table.foreignKeys.map(fk => {
            const fieldName = this.toCamelCase(fk.referencedEntity) + 'Id';
            return `Objects.equals(${fieldName}, that.${fieldName})`;
        }).join(' && ');
        const hashFields = table.foreignKeys.map(fk => this.toCamelCase(fk.referencedEntity) + 'Id').join(', ');
        keyClass += `        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof ${table.name}Id)) return false;
            ${table.name}Id that = (${table.name}Id) o;
            return ${equalsComparison};
        }

        @Override
        public int hashCode() {
            return Objects.hash(${hashFields});
        }
    }
`;
        return keyClass;
    }

    generateFields(table) {
        let code = '';
        table.additionalAttributes.forEach(attr => {
            code += this.generateAdditionalField(attr);
        });
        // Añadir referencias ManyToOne con @MapsId para cada foreign key
        table.foreignKeys.forEach(fk => {
            const entity = this.entities.find(e => e.name === fk.referencedEntity);
            if (!entity) return;
            const relField = this.toCamelCase(fk.referencedEntity);
            const idField = this.toCamelCase(fk.referencedEntity) + 'Id';
            code += `\n    @ManyToOne(fetch = FetchType.LAZY)\n`;
            code += `    @MapsId("${idField}")\n`;
            code += `    @JoinColumn(name = "${fk.columnName}")\n`;
            code += `    @JsonIgnoreProperties("${this.toCamelCase(table.name)}s")\n`;
            code += `    private ${fk.referencedEntity} ${relField};\n`;
        });
        return code;
    }

    generateAdditionalField(attr) {
        let code = '\n';
        const columnName = this.toSnakeCase(attr.name);
        code += `    @Column(name = "${columnName}")\n`;
        if (attr.type === 'String') {
            code += `    @NotBlank(message = "${attr.name} no puede estar vacío")\n`;
        } else {
            code += `    @NotNull(message = "${attr.name} no puede ser nulo")\n`;
        }
        const javaType = this.mapTypeToJava(attr.type);
        const normalizedName = this.toCamelCase(attr.name);
        code += `    private ${javaType} ${normalizedName};\n`;
        return code;
    }

    generateConstructors(table) {
        let code = `    /**
     * Constructor vacío requerido por JPA
     */
    public ${table.name}() {
    }

`;
        code += `    /**
     * Constructor con clave compuesta
     */
    public ${table.name}(${table.name}Id id) {
        this.id = id;
    }
`;
        return code;
    }

    generateGettersSetters(table) {
        let code = '';
        code += `
    public ${table.name}Id getId() {
        return id;
    }

    public void setId(${table.name}Id id) {
        this.id = id;
    }
`;
        table.additionalAttributes.forEach(attr => {
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
        // getters/setters para las referencias ManyToOne (@MapsId)
        table.foreignKeys.forEach(fk => {
            const relField = this.toCamelCase(fk.referencedEntity);
            const capitalizedName = this.capitalize(relField);
            code += `
    public ${fk.referencedEntity} get${capitalizedName}() {
        return this.${relField};
    }

    public void set${capitalizedName}(${fk.referencedEntity} ${relField}) {
        this.${relField} = ${relField};
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

    toSnakeCase(str) {
        return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    }

    toCamelCase(str) {
        return str.charAt(0).toLowerCase() + str.slice(1);
    }

    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

export default ManyToManyEntityGenerator;