# 📅 Quedadas

Calendario compartido para cuadrar planes con grupos de amigos. Cada persona marca en qué **mañanas, tardes y noches** está disponible. Verde = disponible, rojo = no disponible (por defecto).

- **Grupos privados**: cada grupo tiene su propio enlace secreto. Solo quien tiene el enlace ve ese grupo; la base de datos no devuelve nada sin el código.
- **Lobby sin contraseña**: dentro de un grupo, eliges tu nombre o creas uno nuevo.
- **Marcar**: toca un hueco para cambiarlo. Con ratón puedes arrastrar para pintar varios.
- **Ver al grupo**: cada hueco muestra cuántos pueden (`3/5`); borde dorado si pueden todos. Pulsa el número del día para ver quién puede.
- **Mejores huecos** del mes y **tiempo real** (lo que marca un amigo aparece solo).
- **Modo administrador** (`admin.html`, enlace «Admin» en cada grupo): crear, renombrar y borrar grupos, copiar su enlace, cambiar el enlace si se ha filtrado, quitar personas y cambiar la contraseña de admin.

Web estática en **GitHub Pages**; datos en **Nhost** (empresa sueca, datos en la UE, plan gratuito).

## Puesta en marcha / actualización
1. **GitHub Pages**: Settings → Pages → Source: **GitHub Actions**.
2. **Nhost**: proyecto gratuito (Starter) en una región de Europa; su *subdomain* y *region* van en `config.js`.
3. **Base de datos**: abre `https://<usuario>.github.io/<repo>/setup.html`, pega el Admin Secret de Nhost (Settings → Secrets → `HASURA_GRAPHQL_ADMIN_SECRET`; si no lo conoces, ponle uno nuevo con el lápiz) y pulsa *Preparar base de datos*. Se puede repetir sin perder datos.
4. **Admin**: entra en `admin.html` con la contraseña inicial `administrador` y **cámbiala enseguida**.

## Seguridad
- Los visitantes usan el rol `public` de Nhost, que **no puede leer ninguna tabla**: solo llamar a funciones que exigen el código del grupo o la contraseña de admin.
- La contraseña de admin se guarda cifrada (bcrypt) en la base de datos y se comprueba allí.
- Dentro de un grupo no hay login a propósito: quien tenga el enlace puede entrar como cualquiera del grupo.
- El plan gratuito de Nhost pausa el proyecto tras una semana sin uso; se reactiva desde su panel.

## Archivos
```
index.html, app.js    calendario de un grupo (?g=<código>)
admin.html, admin.js  modo administrador
setup.html, setup.js  preparación/actualización de la base de datos
store.js              llamadas a la API de Nhost
styles.css            estilos (claro/oscuro, móvil)
config.js             subdominio y región de Nhost
db/schema.sql         tablas, funciones seguras y migración desde la versión con tags
.github/workflows/pages.yml   despliegue automático a GitHub Pages
```
