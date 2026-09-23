/** Campos persistentes, incluidos todos los niveles de herencia, para consultas seguras. */
export function atributosListado(entity, entities, relationships, visitados = new Set()) {
    if (!entity || visitados.has(entity.id)) return [];
    visitados.add(entity.id);
    const relacion = relationships.find(r => r.type === 'inheritance' && (
        (r.source === entity.id && (r.sourceMultiplicity?.includes('*') || !r.sourceMultiplicity)) ||
        (r.target === entity.id && r.targetMultiplicity?.includes('*'))
    ));
    const padre = relacion && entities.find(e => e.id === (relacion.source === entity.id ? relacion.target : relacion.source));
    const heredados = padre ? atributosListado(padre, entities, relationships, visitados) : [];
    const propios = (entity.attributes || []).filter(a =>
        !(padre && (a.isPrimaryKey || (a.isForeignKey && a.referencedEntity === padre.name))) &&
        !a.isRelationshipAttribute
    );
    return [...new Map([...heredados, ...propios].map(a => [a.name, a])).values()];
}

export function generarConsulta(entity, entities, relationships, campoJava, conPermisos = false) {
    const attrs = atributosListado(entity, entities, relationships);
    const pk = campoJava(attrs.find(a => a.isPrimaryKey)?.name || 'id');
    const campos = [...new Set([pk, ...attrs.filter(a => !a.isForeignKey).map(a => campoJava(a.name))])];
    const textos = attrs.filter(a => !a.isForeignKey && a.type === 'String');
    const filtros = attrs.filter(a => a.isForeignKey && a.referencedEntity).map(a => {
        const otra = entities.find(e => e.name === a.referencedEntity);
        const clave = atributosListado(otra, entities, relationships).find(x => x.isPrimaryKey);
        const nombre = campoJava(a.name);
        const conversion = ({Long: 'Long.valueOf(valor)', Integer: 'Integer.valueOf(valor)',
            Double: 'Double.valueOf(valor)', Float: 'Float.valueOf(valor)',
            UUID: 'java.util.UUID.fromString(valor)'})[clave?.type || 'Long'] || 'valor';
        return { validar: `        if (filtros.containsKey("${nombre}Id")) {
                String valor = filtros.get("${nombre}Id");
                if (valor == null || valor.isBlank()) throw new IllegalArgumentException("El filtro ${nombre}Id necesita un ID");
                try { valores.put("${nombre}Id", ${conversion}); }
                catch (IllegalArgumentException e) { throw new IllegalArgumentException("ID inválido para el filtro ${nombre}Id"); }
            }`, condicion: `            if (valores.containsKey("${nombre}Id")) {
                condiciones.add(cb.equal(raiz.get("${nombre}").get("${campoJava(clave?.name || 'id')}"), valores.get("${nombre}Id")));
            }` };
    });
    return `    @Override
    @Transactional(readOnly = true)
    public org.springframework.data.domain.Page<${entity.name}> buscar(
            Integer pagina, Integer tamano, String texto, String orden, java.util.Map<String, String> filtros) {
        if (pagina != null && pagina < 0) throw new IllegalArgumentException("pagina debe ser mayor o igual a 0");
        if (tamano != null && tamano < 1) throw new IllegalArgumentException("tamano debe ser mayor que 0");
        if (pagina != null && (long) pagina * (tamano == null ? 20 : Math.min(tamano, 200)) > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("pagina y tamano exceden el desplazamiento máximo permitido (2147483647)");
        }
        String campo = "${pk}";
        org.springframework.data.domain.Sort.Direction direccion = org.springframework.data.domain.Sort.Direction.DESC;
        if (orden != null && !orden.isBlank()) {
            String[] partes = orden.trim().split(",", -1);
            if (partes.length != 2 || !java.util.Set.of(${campos.map(c => `"${c}"`).join(', ')}).contains(partes[0].trim()) ||
                    !(partes[1].trim().equalsIgnoreCase("asc") || partes[1].trim().equalsIgnoreCase("desc"))) {
                throw new IllegalArgumentException("orden debe tener un campo válido y asc o desc: campo,asc");
            }
            campo = partes[0].trim();
            direccion = org.springframework.data.domain.Sort.Direction.fromString(partes[1].trim());
        }
        org.springframework.data.domain.Sort clasificacion = org.springframework.data.domain.Sort.by(direccion, campo);
        if (!campo.equals("${pk}")) clasificacion = clasificacion.and(org.springframework.data.domain.Sort.by(org.springframework.data.domain.Sort.Direction.DESC, "${pk}"));
        java.util.Map<String, Object> valores = new java.util.HashMap<>();
${filtros.map(f => f.validar).join('\n')}
        org.springframework.data.jpa.domain.Specification<${entity.name}> criterio = (raiz, consulta, cb) -> {
            java.util.List<jakarta.persistence.criteria.Predicate> condiciones = new java.util.ArrayList<>();
            if (texto != null && !texto.isBlank()) {
                String patron = "%" + texto.trim().toLowerCase(java.util.Locale.ROOT).replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
                condiciones.add(${textos.length ? `cb.or(${textos.map(a => `cb.like(cb.lower(raiz.<String>get("${campoJava(a.name)}")), patron, '!')`).join(', ')})` : 'cb.disjunction()'});
            }
${filtros.map(f => f.condicion).join('\n')}
            return cb.and(condiciones.toArray(new jakarta.persistence.criteria.Predicate[0]));
        };
${conPermisos ? `        criterio = criterio.and(autorizacion.alcance("${entity.name}", "ver"));` : ''}
        if (pagina == null && tamano == null) {
            return new org.springframework.data.domain.PageImpl<>(repository.findAll(criterio, clasificacion));
        }
        return repository.findAll(criterio, org.springframework.data.domain.PageRequest.of(
            pagina == null ? 0 : pagina, tamano == null ? 20 : Math.min(tamano, 200), clasificacion));
    }
`;
}
