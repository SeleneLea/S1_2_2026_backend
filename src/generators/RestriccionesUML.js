/** Restricciones del atributo compartidas por Java, SQL, datos de ejemplo y Flutter. */
export const restriccionesDe = texto => {
    const bruto = String(texto || '');
    const reglas = { obligatorio: true, unico: false, minimo: null, maximo: null };
    for (const bloque of bruto.matchAll(/\{([^}]*)\}/g)) {
        const partes = bloque[1].match(/(?:[^,"]|"[^"]*")+/g) || [];
        for (const valor of partes) {
            const parte = valor.trim();
            const rango = parte.match(/^(\d+)\s*\.\.\s*(\d+|\*)$/);
            const limite = parte.match(/^(min|max)\s*=\s*(-?\d+(?:\.\d+)?)$/i);
            if (/^(unico|unique)$/i.test(parte)) reglas.unico = true;
            else if (/^(opcional|optional)$/i.test(parte)) reglas.obligatorio = false;
            else if (/^oculto$/i.test(parte)) reglas.oculto = true;
            else if (/^principal$/i.test(parte)) reglas.principal = true;
            else if (/^etiqueta\s*=\s*"[^"]*"$/i.test(parte)) reglas.etiqueta = parte.match(/"([^"]*)"/)[1];
            else if (/^orden\s*=\s*\d+$/i.test(parte)) reglas.orden = Number(parte.split('=')[1]);
            else if (rango) {
                const desde = Number(rango[1]);
                const hasta = rango[2] === '*' ? null : Number(rango[2]);
                if (desde === 0 && (hasta === 1 || hasta === null)) reglas.obligatorio = false;
                else { reglas.minimo = desde; reglas.maximo = hasta; }
            } else if (limite) reglas[limite[1].toLowerCase() === 'min' ? 'minimo' : 'maximo'] = Number(limite[2]);
            else throw new Error(`Restricción UML desconocida: ${parte}`);
        }
    }
    if (reglas.minimo !== null && reglas.maximo !== null && reglas.minimo > reglas.maximo) {
        throw new Error('El mínimo del atributo no puede superar su máximo.');
    }
    return { limpio: bruto.replace(/\{[^}]*\}/g, '').trim(), reglas };
};
export const largoTexto = attr => attr.maximo ?? (/^TEXT$/i.test(attr.sqlType || '')
    ? null : Number(attr.sqlType?.match(/\d+/)?.[0] || 255));

/** Rechaza restricciones incompatibles antes de producir archivos que no puedan ejecutarse. */
export const validarRestricciones = attr => {
    for (const clave of ['minimo', 'maximo']) {
        if (attr[clave] != null && (typeof attr[clave] !== 'number' || !Number.isFinite(attr[clave]))) {
            throw new Error(`${attr.name}: ${clave} debe ser un número finito.`);
        }
    }
    if (attr.minimo != null && attr.maximo != null && attr.minimo > attr.maximo) {
        throw new Error(`${attr.name}: el mínimo supera el máximo.`);
    }
    if (attr.type === 'String') {
        const minimo = attr.minimo ?? 0;
        const maximo = largoTexto(attr);
        if (!Number.isInteger(minimo) || minimo < 0 || (maximo != null && (!Number.isInteger(maximo) || maximo < 1 || minimo > maximo))) {
            throw new Error(`${attr.name}: el largo de texto debe ser un rango entero válido.`);
        }
    } else if ((attr.minimo != null || attr.maximo != null) && !['Integer', 'Long', 'Float', 'Double', 'BigDecimal'].includes(attr.type)) {
        throw new Error(`${attr.name}: este tipo no admite límites numéricos.`);
    }
    if (['Integer', 'Long'].includes(attr.type) && attr.minimo != null && attr.maximo != null && Math.ceil(attr.minimo) > Math.floor(attr.maximo)) {
        throw new Error(`${attr.name}: el rango no contiene ningún entero.`);
    }
    return attr;
};
