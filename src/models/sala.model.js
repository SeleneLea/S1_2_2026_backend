import pool from '../config/db.js';
import { createUserSala } from './usersala.model.js';

export const createSala = async (title, xml, description, userId) => {
    const result = await pool.query(
        `INSERT INTO "Salas" (title, xml, description, userId) VALUES ($1, $2, $3, $4) RETURNING *`,
        [title, xml, description, userId]
    );
    const sala = result.rows[0];
    // Intentar añadir al creador como participante en Usersala
    try {
        await createUserSala(userId, sala.id);
        // console.log(`DB: creator userId=${userId} added to Usersala for sala ${sala.id}`);
    } catch (err) {
        // No detener la creación si la inserción en Usersala falla (por ejemplo por unique constraint)
        console.warn(`DB: could not insert Usersala for user ${userId} sala ${sala.id}: ${err.message}`);
    }
    return sala;
};

export const getSalaById = async (id) => {
    // console.log(`DB: executing query for sala ID: ${id}`);
    const result = await pool.query(
        'SELECT * FROM "Salas" WHERE id = $1 AND eliminar = false',
        [id]
    );
    // console.log(`DB: query executed, rows found: ${result.rows.length}`);
    
    if (result.rows.length > 0) {
        const sala = result.rows[0];
        // console.log(`DB: Sala found - ID: ${sala.id}, Title: "${sala.title}"`);
        // console.log(`DB: XML length: ${sala.xml ? sala.xml.length : 0} chars`);
        // if (sala.xml) {
        //     console.log(`DB: XML preview:`, sala.xml.substring(0, 50) + '...');
        // }
    }
    
    return result.rows;
};

export const getSala = async (userId) => {
    const result = await pool.query('SELECT * FROM "Salas" WHERE userId = $1 and eliminar = false', [userId]);
    // console.log(`DB: getSala executed for userId=${userId}, rows=${result.rows.length}`);
    if (result.rows.length > 0) {
        // console.log('DB: sample row:', JSON.stringify(result.rows[0]));
    }
    return result.rows;
};

export const updateSala = async (id, title, xml, description, io = null) => {
    // console.log(`UPDATE: starting update for sala ID: ${id}`);
    // console.log(`UPDATE: io instance available for broadcast: ${!!io}`);
    
    let fields = [];
    let values = [];
    let counter = 1;
    
    if (title !== undefined && title !== null) {
        fields.push(`title = $${counter++}`);
        values.push(title);
    // console.log(`UPDATE: updating field title: "${title}"`);
    }
    
    if (xml !== undefined && xml !== null) {
        fields.push(`xml = $${counter++}`);
        values.push(xml);
    // console.log(`UPDATE: updating field xml (preview): ${xml.substring(0, 50)}... (${xml.length} chars)`);
    }
    
    if (description !== undefined && description !== null) {
        fields.push(`description = $${counter++}`);
        values.push(description);
    // console.log(`UPDATE: updating field description: "${description}"`);
    }
    
    if (fields.length === 0) {
    // console.log(`UPDATE: error - no fields to update for sala ${id}`);
        throw new Error('No hay campos para actualizar');
    }
    
    values.push(id);
    const query = `UPDATE "Salas" SET ${fields.join(', ')} WHERE id = $${counter} AND eliminar = false RETURNING *`;
    // console.log(`UPDATE: query to execute: ${query}`);
    // console.log(`UPDATE: parameter values:`, values);
    
    const result = await pool.query(query, values);
    
    if (result.rows.length > 0) {
        const updatedSala = result.rows[0];
    // console.log(`UPDATE: Sala ${id} updated successfully - db id: ${updatedSala.id}`);
        
        // 🚀 MEJORADO: Broadcast más robusto y con mejor logging
        if (xml !== undefined && xml !== null && io) {
            // console.log(`BROADCAST: starting notify users in sala ${id}`);
            
            try {
                // Parsear el XML para enviarlo como estado
                const parsedState = JSON.parse(xml);
                
                // Verificar si hay usuarios conectados a la sala
                const clientesEnSala = io.sockets.adapter.rooms.get(`sala_${id}`);
                const numClientesEnSala = clientesEnSala ? clientesEnSala.size : 0;
                // console.log(`BROADCAST: ${numClientesEnSala} clients connected in sala_${id}`);
                
                if (numClientesEnSala > 0) {
                    // Emitir a todos los usuarios en la sala
                    io.to(`sala_${id}`).emit('xmlActualizado', {
                        salaId: parseInt(id, 10), // ensure number
                        nuevoEstado: parsedState,
                        timestamp: Date.now(),
                        source: 'database_update',
                        message: `board synchronized from database (${new Date().toLocaleTimeString()})`
                    });
                    
                // console.log(`BROADCAST: xml update sent to ${numClientesEnSala} users in sala_${id}`);
                } else {
                // console.log(`BROADCAST: no connected users in sala_${id} - no broadcast sent`);
                }
            } catch (error) {
                console.error(`BROADCAST: error parsing XML for sala ${id}:`, error);
            }
        } else if (xml !== undefined && xml !== null && !io) {
          // console.log(`BROADCAST: xml updated but no io instance available for broadcast`);
        }
        
        return updatedSala;
    } else {
    // console.log(`UPDATE: error - sala ${id} not found for update`);
        throw new Error(`Sala con ID ${id} no encontrada o ya eliminada`);
    }
};

export const deleteSala = async (id) => {
    const result = await pool.query(
        'UPDATE "Salas" SET eliminar = true WHERE id = $1 RETURNING *',
        [id]
    );
    return result.rows[0];
};
