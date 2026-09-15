/**
 * Genera el script DDL de PostgreSQL a partir del modelo ya convertido
 * (el mismo que alimenta al generador de Spring Boot, con las claves foráneas
 * ya derivadas de las cardinalidades).
 *
 * Objetivo: entregar el modelo relacional como artefacto descargable. El
 * esquema resultante debe coincidir con el que Hibernate crea al arrancar el
 * proyecto generado, para que ambos caminos sean equivalentes.
 */

const toSnakeCase = (str) =>
    String(str || '').replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');

// Mismo criterio que EntityGenerator.mapTypeToJava, pero hacia tipos SQL
const TIPOS_SQL = {
    'String': 'VARCHAR(255)',
    'Integer': 'INTEGER',
    'Long': 'BIGINT',
    'Double': 'DOUBLE PRECISION',
    'Float': 'REAL',
    'Boolean': 'BOOLEAN',
    'Date': 'DATE',
    'LocalDate': 'DATE',
    'LocalDateTime': 'TIMESTAMP',
    'LocalTime': 'TIME',
    // Hibernate 6 crea BigDecimal como numeric(38,2)
    'BigDecimal': 'NUMERIC(38,2)',
    'UUID': 'UUID'
};

class SqlDDLGenerator {
    /**
     * @param {object} converted  { elements: {...}, connections: {...} }
     * @param {string} dbName     nombre de la base (solo para los comentarios)
     */
    constructor(converted, dbName = 'app_db') {
        // Interfaces y enumeraciones no se materializan como tablas
        this.elements = Object.values(converted.elements || {}).filter(
            e => e.stereotype !== 'interface' && e.stereotype !== 'enumeration'
        );
        this.connections = Object.values(converted.connections || {});
        this.dbName = dbName;
    }

    tipoSql(tipo) {
        return TIPOS_SQL[tipo] || 'VARCHAR(255)';
    }

    // Columna de un atributo: los textos respetan su sqlType (TEXT para text y
    // geometrías WKT, VARCHAR(n) para char/varchar), igual que @Column en la entidad
    tipoColumna(attr) {
        const sqlType = String(attr.sqlType || '').toUpperCase();
        if (attr.type === 'String' && /^(TEXT|VARCHAR\(\d+\))$/.test(sqlType)) return sqlType;
        return this.tipoSql(attr.type);
    }

    // Tipo de una columna que apunta a otra tabla: el de su clave primaria (o la del
    // padre en una herencia). Hibernate crea la FK con ese tipo; antes el script usaba
    // siempre BIGINT y no coincidía con un "id: int".
    tipoReferencia(entidad) {
        const vistos = new Set();
        for (let actual = entidad; actual && !vistos.has(actual.id); actual = this.padreDe(actual)) {
            vistos.add(actual.id);
            const pk = (actual.attributes || []).find(a => a.isPrimaryKey);
            if (pk) return this.tipoSql(pk.type);
        }
        return 'BIGINT';
    }

    tabla(entidad) {
        return toSnakeCase(entidad.name);
    }

    // La entidad padre de una herencia, si la hay (estrategia JOINED)
    padreDe(entidad) {
        const rel = this.connections.find(c =>
            c.type === 'inheritance' && (c.source === entidad.id || c.target === entidad.id)
        );
        if (!rel) return null;
        // La flecha va del hijo (source) al padre (target)
        if (rel.source !== entidad.id) return null;
        return this.elements.find(e => e.id === rel.target) || null;
    }

    generate() {
        const lineas = [];
        const fks = [];

        lineas.push('-- =====================================================');
        lineas.push(`-- Modelo relacional generado desde el diagrama de clases`);
        lineas.push(`-- Base de datos sugerida: ${this.dbName}`);
        lineas.push(`-- Motor: PostgreSQL`);
        lineas.push('-- =====================================================');
        lineas.push('');
        lineas.push(`-- CREATE DATABASE ${this.dbName};`);
        lineas.push('');

        // ---- Tablas de entidades ----
        for (const entidad of this.elements) {
            const tabla = this.tabla(entidad);
            const padre = this.padreDe(entidad);
            const cols = [];

            if (padre) {
                // Herencia JOINED: la hija comparte el id del padre (PK y FK a la vez)
                cols.push(`    id ${this.tipoReferencia(padre)} NOT NULL`);
            }

            for (const attr of (entidad.attributes || [])) {
                const nombre = toSnakeCase(attr.name);

                if (attr.isPrimaryKey) {
                    if (padre) continue; // ya declarada arriba
                    const serial = (attr.type === 'Long') ? 'BIGSERIAL'
                        : (attr.type === 'Integer') ? 'SERIAL'
                        : this.tipoSql(attr.type);
                    cols.push(`    ${nombre} ${serial} NOT NULL`);
                    continue;
                }

                if (attr.isForeignKey && attr.referencedEntity) {
                    // Misma convención que EntityGenerator: la columna termina en _id
                    const col = nombre.endsWith('_id') ? nombre : `${nombre}_id`;
                    const destino = this.elements.find(e => e.name === attr.referencedEntity);
                    // Igual que EntityGenerator: en una composición la FK es obligatoria
                    cols.push(`    ${col} ${destino ? this.tipoReferencia(destino) : 'BIGINT'}${attr.isRequired ? ' NOT NULL' : ''}`);
                    if (destino) {
                        fks.push({
                            tabla,
                            columna: col,
                            tablaDestino: this.tabla(destino),
                            columnaDestino: 'id'
                        });
                    }
                    continue;
                }

                cols.push(`    ${nombre} ${this.tipoColumna(attr)}`);
            }

            cols.push(`    CONSTRAINT pk_${tabla} PRIMARY KEY (id)`);

            lineas.push(`CREATE TABLE ${tabla} (`);
            lineas.push(cols.join(',\n'));
            lineas.push(');');
            lineas.push('');

            if (padre) {
                fks.push({
                    tabla,
                    columna: 'id',
                    tablaDestino: this.tabla(padre),
                    columnaDestino: 'id',
                    comentario: `herencia: ${entidad.name} hereda de ${padre.name}`
                });
            }
        }

        // ---- Tablas intermedias de muchos-a-muchos ----
        for (const conn of this.connections) {
            if (conn.type !== 'many-to-many-direct') continue;
            const origen = this.elements.find(e => e.id === conn.source);
            const destino = this.elements.find(e => e.id === conn.target);
            if (!origen || !destino) continue;

            const tOrigen = this.tabla(origen);
            const tDestino = this.tabla(destino);
            const intermedia = `${tOrigen}_${tDestino}`;
            const colOrigen = `${tOrigen}_id`;
            const colDestino = `${tDestino}_id`;

            lineas.push(`-- Relación muchos a muchos: ${origen.name} <-> ${destino.name}`);
            lineas.push(`CREATE TABLE ${intermedia} (`);
            lineas.push(`    ${colOrigen} ${this.tipoReferencia(origen)} NOT NULL,`);
            lineas.push(`    ${colDestino} ${this.tipoReferencia(destino)} NOT NULL,`);
            // UNIQUE (no PRIMARY KEY): es lo que crea Hibernate con el @JoinTable generado
            lineas.push(`    CONSTRAINT uk_${intermedia} UNIQUE (${colOrigen}, ${colDestino})`);
            lineas.push(');');
            lineas.push('');

            fks.push({ tabla: intermedia, columna: colOrigen, tablaDestino: tOrigen, columnaDestino: 'id' });
            fks.push({ tabla: intermedia, columna: colDestino, tablaDestino: tDestino, columnaDestino: 'id' });
        }

        // ---- Claves foráneas al final: evita problemas de orden de creación ----
        if (fks.length > 0) {
            lineas.push('-- =====================================================');
            lineas.push('-- Claves foráneas');
            lineas.push('-- =====================================================');
            lineas.push('');
            fks.forEach((fk, i) => {
                if (fk.comentario) lineas.push(`-- ${fk.comentario}`);
                lineas.push(
                    `ALTER TABLE ${fk.tabla} ADD CONSTRAINT fk_${fk.tabla}_${fk.columna}_${i}` +
                    ` FOREIGN KEY (${fk.columna}) REFERENCES ${fk.tablaDestino}(${fk.columnaDestino});`
                );
            });
            lineas.push('');
        }

        return lineas.join('\n');
    }
}

export default SqlDDLGenerator;
