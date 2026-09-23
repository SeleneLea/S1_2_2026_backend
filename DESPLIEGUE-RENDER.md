# Despliegue en Render

Todo se publica en **un solo servicio web** de Render más una base PostgreSQL:

- el backend (este repo) sirve la API (`/apis/...`), la colaboración en tiempo real (`/socket.io`)
  y el frontend compilado;
- el frontend (repo `Calvimontes99/SW1_Frontend_P1_02_2026`, público) se clona y compila durante el build.

No se usa Vercel ni un sitio estático aparte: con todo en la misma URL la cookie de sesión funciona
en cualquier navegador (también Safari/iPhone), no hay que configurar CORS y Socket.IO mantiene su
conexión abierta (Vercel no admite WebSockets persistentes).

La configuración está en [`render.yaml`](render.yaml).

## 1. Crear el servicio (una sola vez)

1. Entrar a <https://dashboard.render.com> con la cuenta de GitHub **Calvimontes99**.
2. **New > Blueprint** y elegir el repo `SW1_Backend_P1_02_2026` (rama `main`).
3. Render lee `render.yaml` y muestra lo que va a crear: el servicio `diagramador-uml` y la base
   `diagramador-db`. Pide un solo dato:
   - `GEMINI_API_KEYS`: las claves de Gemini separadas por coma. Si se deja vacía, la app funciona
     solo con la IA local del navegador.
4. **Apply**. El primer build tarda unos minutos. `TOKEN_SECRET` se genera solo y las tablas se
   crean solas al arrancar contra la base vacía.
5. La app queda en `https://diagramador-uml.onrender.com` (o con un sufijo si el nombre está
   tomado). Render da HTTPS automáticamente, requisito de la IA sin internet.

## 2. Publicar cambios

- **Backend:** cada push a `main` de este repo vuelve a desplegar solo.
- **Frontend:** un push al repo del frontend no avisa a Render por sí solo. Opciones:
  - en Render, **Manual Deploy > Deploy latest commit** (recompila con el último frontend); o
  - automático: en Render copiar **Settings > Deploy Hook** y guardarlo en GitHub, en el repo del
    frontend, en **Settings > Secrets and variables > Actions** con el nombre
    `RENDER_DEPLOY_HOOK_URL`. El workflow `.github/workflows/desplegar-render.yml` del frontend lo
    llama en cada push.

## 3. Comprobar que funciona

| URL | Debe responder |
|---|---|
| `/apis/health/db` | `{"success":true,...}` (Render lo usa como health check) |
| `/apis/ai/health` | cuántas claves de Gemini hay y cuántas tienen cuota |
| `/` | la pantalla de inicio de la app |

## Cuentas de prueba

Al arrancar, el servidor crea dos cuentas para probar la app y la edición conjunta sin registrarse:

| Correo | Contraseña | Nombre |
|---|---|---|
| `prueba1@gmail.com` | `12345678` | Usuario Prueba 1 |
| `prueba2@gmail.com` | `12345678` | Usuario Prueba 2 |

La contraseña sale de la variable `CLAVE_USUARIOS_PRUEBA` de `render.yaml`. Es pública a propósito
porque es un servidor de pruebas; para un uso real, quitarla o cambiarla. Si se cambia, al arrancar
las cuentas toman la nueva; si se borra, quedan como estaban.

## 4. Planes: gratis para probar, pagado para la defensa

| Recurso | Plan en `render.yaml` | Limitación | Para la defensa |
|---|---|---|---|
| Servicio web | `free` | Se duerme tras 15 min sin visitas; despertar tarda ~1 min y corta la colaboración en curso | `starter` (siempre encendido) |
| PostgreSQL | `free` | **Se borra a los 30 días de creada** (14 días de gracia para pasar a pago) | `basic-256mb` |

El cambio se hace desde el panel de Render (**Settings > Instance Type** del servicio y de la base).
Ambos juntos rondan 13 USD al mes y se pueden bajar después de la defensa.

**No escalar a más de una instancia:** el estado de las salas en edición vive en la memoria del
proceso; con dos instancias, los usuarios de una misma sala no se verían entre sí.

## 5. Pasar los tableros de la base local a Render (opcional)

En Render, en la base `diagramador-db`, copiar la **External Database URL**. Luego, en la PC:

```bash
pg_dump -Fc --no-owner --no-acl -h localhost -U postgres -d diagrama_dev -f diagramador.dump
pg_restore --clean --if-exists --no-owner --no-acl -d "EXTERNAL_DATABASE_URL?sslmode=require" diagramador.dump
```

`--clean` reemplaza las tablas vacías que el backend creó en su primer arranque. Después, en Render,
**Manual Deploy > Restart service** para que el servidor lea los datos restaurados.

## Qué no usa Render

`railway.toml`, `server.js` y `public/_redirects` del frontend son de configuraciones anteriores:
Render no los usa y no estorban.
