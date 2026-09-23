# Batería de pruebas de las exportaciones

Tres scripts que exportan tableros del diagramador local y comprueban que los proyectos
generados sirvan de verdad: que compilen, arranquen, tengan datos y que la app pase el
análisis que corre el editor antes de compilar.

La especificación de lo que falta está en [../07-pruebas-automaticas.md](../07-pruebas-automaticas.md).

## Uso

```bash
# 1. el diagramador tiene que estar corriendo con el código actual
cd software-1---parcial2/backend && npm start          # puerto 8083

# 2. en otra consola
cd software-1---parcial2/backend/correcciones/pruebas
./exportar.sh                    # los cinco tableros de ejemplo
./probar-backends.sh             # base limpia + arranque + endpoints por tema
./analizar-flutter.sh            # flutter analyze por app
```

Un tema suelto: `./exportar.sh clinica && ./probar-backends.sh clinica`.

Un diagrama de `diagramas/`: `./exportar.sh nombres-conflictivos` lo carga como tablero de
prueba en el diagramador y lo exporta.

Los proyectos quedan en `backend/temp/pruebas/<tema>/{spring,flutter}` y los registros en
`backend/temp/pruebas/*.log`. `temp/` está en `.gitignore`.

`probar-backends.sh` y `analizar-flutter.sh` devuelven código distinto de cero si algo falla,
así que se pueden encadenar con `&&`.

## Qué comprueba cada uno

**`exportar.sh`** — inicia sesión en el diagramador, busca el tablero por título (los ids
cambian entre instalaciones), pide las dos exportaciones y descomprime. Avisa si alguna
devuelve algo distinto de 200.

**`probar-backends.sh`** — por cada tema, en su propio puerto (8091 en adelante) y su propia
base (`prueba_<tema>`, que se borra y se crea):

1. arranca con `spring-boot:run`;
2. muestra lo que sembró `DatosDemo`;
3. recorre todos los endpoints del proyecto y avisa de los que dan error o vienen vacíos;
4. crea un registro copiando uno sembrado **sin enviar el id**;
5. comprueba que sin sesión responda 401 y que un rol de solo consulta no pueda modificar;
6. comprueba que un PUT con una lista vacía vacíe la relación (corrección 03; hoy falla).

**`analizar-flutter.sh`** — `flutter create . --platforms android`, `flutter pub get` y
`flutter analyze` por app, y cuenta las pantallas generadas.

## Variables

| Variable | Por omisión | Para qué |
|---|---|---|
| `SALIDA` | `backend/temp/pruebas` | dónde quedan los proyectos y los registros |
| `DIAGRAMADOR` | `http://localhost:8083` | diagramador local |
| `CORREO` / `CLAVE` | `prueba1@gmail.com` / `12345678` | usuario de prueba del diagramador |
| `PUERTO_BASE` | `8091` | primer puerto de los backends generados |

Los datos de Postgres salen de `backend/.env` (`DB_USER`, `DB_PASSWORD`, `DB_PORT`, `DB_NAME`);
los scripts no los imprimen.

## Trampas de este entorno (Windows)

- Maven y Gradle necesitan un temporal corto o fallan con `Unable to establish loopback
  connection`. Los scripts exportan `TMP`/`TEMP` a `C:\tmpjava`.
- Si un `DROP DATABASE` dice que la base está en uso, quedó un backend vivo de una corrida
  anterior: `netstat -ano | grep :PUERTO` y `taskkill //PID <pid> //F`.
- Si se edita un generador y no se reinicia `npm start`, se exporta con el código viejo que
  quedó en memoria y las pruebas mienten.
