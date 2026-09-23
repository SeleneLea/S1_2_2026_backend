import {
    atributosDTO, claveDeAtributo, claveMuchosAMuchos, esSoloFecha, identificadorDart,
    muchosAMuchosPropios, nombreClase, tipoDart
} from './FlutterNombres.js';

/**
 * Modelos Dart con el mismo contrato JSON que los DTO del backend Spring Boot.
 *
 * Antes: el ID era obligatorio (crear exigía inventar uno), BigDecimal se leía
 * como String aunque el backend envía un número (la lectura fallaba en tiempo de
 * ejecución) y faltaban los campos heredados y los IDs de los muchos a muchos.
 */
class FlutterModelGenerator {
    constructor(entities = [], relationships = []) {
        this.entities = entities;
        this.relationships = relationships;
    }

    generate(entity) {
        const clase = nombreClase(entity.name);
        const atributos = atributosDTO(entity, this.entities, this.relationships);
        const campos = atributos.map(attr => {
            const clave = claveDeAtributo(attr);
            return {
                clave,
                nombre: identificadorDart(clave),
                tipo: tipoDart(attr.type),
                soloFecha: esSoloFecha(attr.type),
                esPk: attr.isPrimaryKey === true
            };
        });
        muchosAMuchosPropios(entity, this.entities, this.relationships).forEach(otra => {
            const clave = claveMuchosAMuchos(otra);
            campos.push({ clave, nombre: identificadorDart(clave), tipo: 'List<int>' });
        });

        const pk = campos.find(c => c.esPk);
        const usaFechaHora = campos.some(c => c.tipo === 'DateTime' && !c.soloFecha);

        const declaraciones = campos.map(c => `  final ${c.tipo}? ${c.nombre};`).join('\n');
        const parametros = campos.map(c => `    this.${c.nombre},`).join('\n');
        const desdeJson = campos.map(c => `      ${c.nombre}: ${this.leer(c)},`).join('\n');
        const aJson = campos.map(c => `      '${c.clave}': ${this.escribir(c)},`).join('\n');
        const parametrosCopia = campos.map(c => `    ${c.tipo}? ${c.nombre},`).join('\n');
        const argumentosCopia = campos.map(c => `      ${c.nombre}: ${c.nombre} ?? this.${c.nombre},`).join('\n');

        // Igualdad por ID: los desplegables comparan registros que llegan en peticiones distintas
        const igualdad = pk ? `
  @override
  bool operator ==(Object other) =>
      identical(this, other) || (other is ${clase} && ${pk.nombre} != null && other.${pk.nombre} == ${pk.nombre});

  @override
  int get hashCode => ${pk.nombre}?.hashCode ?? identityHashCode(this);
` : '';

        const usaFechas = campos.some(c => c.tipo === 'DateTime');
        const ayudaFecha = (usaFechaHora ? `
/// El backend usa LocalDateTime: fecha y hora locales sin zona ni milisegundos.
String _fechaHora(DateTime fecha) =>
    (fecha.isUtc ? fecha.toLocal() : fecha).toIso8601String().split('.').first;
` : '') + (usaFechas ? `
/// Acepta "2026-09-13T10:30:00" y también [2026, 9, 13, 10, 30], que es como
/// Jackson envía las fechas si el backend las serializa como marcas de tiempo.
DateTime? _leerFecha(dynamic valor) {
  if (valor == null) return null;
  if (valor is List) {
    final partes = valor.map((e) => (e as num).toInt()).toList();
    int parte(int i) => i < partes.length ? partes[i] : (i < 3 ? 1 : 0);
    return DateTime(parte(0), parte(1), parte(2), parte(3), parte(4), parte(5));
  }
  return DateTime.tryParse(valor.toString());
}
` : '');

        return `/// ${clase}: mismo contrato JSON que ${clase}DTO del backend Spring Boot.
class ${clase} {
${declaraciones}

  const ${clase}({
${parametros}
  });

  factory ${clase}.fromJson(Map<String, dynamic> json) {
    return ${clase}(
${desdeJson}
    );
  }

  Map<String, dynamic> toJson() {
    return {
${aJson}
    };
  }

  ${clase} copyWith({
${parametrosCopia}
  }) {
    return ${clase}(
${argumentosCopia}
    );
  }
${igualdad}}
${ayudaFecha}`;
    }

    leer(c) {
        const valor = `json['${c.clave}']`;
        switch (c.tipo) {
            case 'int': return `(${valor} as num?)?.toInt()`;
            case 'double': return `(${valor} as num?)?.toDouble()`;
            case 'bool': return `${valor} as bool?`;
            case 'DateTime': return `_leerFecha(${valor})`;
            case 'List<int>': return `(${valor} as List?)?.map((e) => (e as num).toInt()).toList()`;
            default: return `${valor}?.toString()`;
        }
    }

    escribir(c) {
        if (c.tipo === 'DateTime') {
            return c.soloFecha
                ? `${c.nombre}?.toIso8601String().substring(0, 10)`
                : `${c.nombre} == null ? null : _fechaHora(${c.nombre}!)`;
        }
        return c.nombre;
    }
}

export default FlutterModelGenerator;
