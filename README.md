# 📅 Quedadas

Calendario compartido para cuadrar planes con amigos. Cada uno marca en qué **mañanas, tardes y noches** está disponible, siempre bajo un **tag** (Cena, Escapada, Partida…). Verde = disponible, rojo = no disponible (por defecto).

- **Lobby sin contraseña**: eliges tu nombre del desplegable o creas uno nuevo.
- **Tags**: eliges un tag en el desplegable y todo lo que marques va con ese tag. Cada tag tiene su propio calendario.
- **Marcar**: toca un hueco para cambiarlo. Con ratón puedes arrastrar para pintar varios de golpe.
- **Ver al grupo**: cada hueco muestra cuántos pueden (`3/5`). Si pueden todos, sale con borde dorado. Pulsa el número del día para ver quién puede en cada franja.
- **Mejores huecos**: lista de las franjas del mes con más gente disponible.
- **Tiempo real**: lo que marca un amigo aparece solo en las pantallas de los demás.

Es una web estática (HTML + JS, sin compilar) publicada en **GitHub Pages**, con los datos en **Nhost** (empresa sueca, datos en la UE, plan gratuito).

## Puesta en marcha (una sola vez)

1. **GitHub Pages**: Settings → Pages → Source: **GitHub Actions**.
2. **Nhost**: crea una cuenta en [nhost.io](https://nhost.io) y un proyecto gratuito (plan Starter) en una región de Europa.
3. **Config**: pon el *subdomain* y la *region* del proyecto en `config.js` y haz commit.
4. **Base de datos**: abre `https://<tu-usuario>.github.io/<repo>/setup.html`, pega el **Admin Secret** de Nhost y pulsa *Preparar base de datos*. Crea las tablas y los permisos solo.

La app queda en `https://<tu-usuario>.github.io/<repo>/`.

## Probar en local
Con `config.js` vacío funciona en **modo demo** (datos solo en tu navegador):

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Notas
- No hay login a propósito: cualquiera con el enlace puede entrar como cualquiera y editar. Los visitantes usan el rol `public` de Nhost, que solo puede leer y escribir estas tablas.
- Para borrar o renombrar a una persona: panel de Nhost → Database → tabla `people` (al borrarla se borra su disponibilidad).
- Borrar un tag desde la app borra también toda la disponibilidad marcada con él.
- El plan gratuito de Nhost pausa el proyecto tras una semana sin uso; se reactiva desde el panel de Nhost.

## Archivos
```
index.html            estructura
styles.css            estilos (modo claro/oscuro, móvil)
app.js                lógica de la app
store.js              acceso a datos (Nhost o modo demo)
config.js             subdominio y región de Nhost
setup.html, setup.js  página de preparación de la base de datos (se usa una vez)
db/schema.sql         tablas de la base de datos
.github/workflows/pages.yml   despliegue automático a GitHub Pages
```
