import pool from '../config/db.js';

const buildUpdateQuery = (tableName, fieldsToUpdate, id) => {
    if (!id) {
        return null;
    }
    const fields = Object.keys(fieldsToUpdate).filter(field => fieldsToUpdate[field] !== undefined);
    if (fields.length === 0) {
        return null;
    }
    const values = fields.map(field => fieldsToUpdate[field]);
    fields.push('updatedAt');
    values.push(new Date());
    let query = `UPDATE "${tableName}" SET `;
    query += fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
    query += ` WHERE id = $${fields.length + 1} AND eliminar = true RETURNING *`;
    values.push(id);
    return { query, values };
};

const getCourseByFilters = async (tableName, filters) => {
    const conditions = Object.keys(filters).map((key, index) => `"${key}" = $${index + 1}`);
    const query = `SELECT * FROM "${tableName}" WHERE ${conditions.join(' AND ')} AND eliminar = true`;
    const result = await pool.query(query, Object.values(filters));
    return result.rows;
};

const getCourseByAll = async (tableName, filters) => {
    const conditions = Object.keys(filters).map((key, index) => `"${key}" = $${index + 1}`);
    const query = `SELECT * FROM "${tableName}" WHERE ${conditions.join(' AND ')}`;
    const result = await pool.query(query, Object.values(filters));
    return result.rows;
};

export { buildUpdateQuery, getCourseByFilters, getCourseByAll };
