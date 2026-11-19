# 📅 Quedadas

Calendario compartido para cuadrar planes con amigos. Cada uno marca en qué **mañanas, tardes y noches** está disponible, siempre bajo un **tag** (Cena, Escapada, Partida…). Verde = disponible, rojo = no disponible (por defecto).

- **Lobby sin contraseña**: eliges tu nombre del desplegable o creas uno nuevo.
- **Tags**: eliges un tag en el desplegable y todo lo que marques va con ese tag. Cada tag tiene su propio calendario.
- **Marcar**: toca un hueco para cambiarlo. Con ratón puedes arrastrar para pintar varios de golpe.
- **Ver al grupo**: cada hueco muestra cuántos pueden (`3/5`). Si pueden todos, sale con borde dorado. Pulsa el número del día para ver quién puede en cada franja.
- **Mejores huecos**: lista de las franjas del mes con más gente disponible.
- **Tiempo real**: lo que marca un amigo aparece solo en las pantallas de los demás.

Es una web estática (HTML + JS, sin compilar) publicada en **GitHub Pages**, con los datos en **Supabase** (plan gratuito).

## Puesta en marcha (≈10 minutos, una sola vez)

### 1. Base de datos en Supabase
1. Crea una cuenta en [supabase.com](https://supabase.com) y un proyecto nuevo (plan Free).
2. Ve a **SQL Editor → New query**, pega el contenido de [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**.
3. Ve a **Project Settings → API** (o **Connect**) y copia:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon / public key** (la clave pública; *no* la `service_role`)

### 2. Variables en GitHub
En este repo: **Settings → Secrets and variables → Actions → pestaña Variables → New repository variable**:

| Nombre | Valor |
| --- | --- |
| `SUPABASE_URL` | la Project URL |
| `SUPABASE_ANON_KEY` | la anon key |

### 3. Activar GitHub Pages
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

Después ve a **Actions → Desplegar en GitHub Pages → Run workflow** (o haz cualquier push a `main`). En un minuto la web estará en:

```
https://<tu-usuario>.github.io/<nombre-del-repo>/
```

Comparte ese enlace con el grupo y listo.

## Probar en local
Sin configurar nada funciona en **modo demo** (los datos se guardan solo en tu navegador):

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

Para probar en local contra Supabase, rellena `config.js` con la URL y la anon key.

## Notas
- No hay login a propósito: cualquiera con el enlace puede entrar como cualquiera y editar. La anon key es pública por diseño; el acceso lo controlan las políticas de `schema.sql`.
- Para borrar o renombrar a una persona, hazlo desde **Supabase → Table Editor → people** (al borrarla se borra su disponibilidad).
- Borrar un tag desde la app borra también toda la disponibilidad marcada con él.
- El plan gratuito de Supabase pausa el proyecto tras ~1 semana sin actividad; se reactiva desde el panel de Supabase.

## Archivos
```
index.html            estructura
styles.css            estilos (modo claro/oscuro, móvil)
app.js                lógica de la app
store.js              acceso a datos (Supabase o modo demo)
config.js             config (la genera el workflow a partir de las variables)
supabase/schema.sql   tablas, permisos y tiempo real
.github/workflows/pages.yml   despliegue automático a GitHub Pages
```
