# My Static Blog

A minimal, SEO-optimized static blog built with vanilla HTML.

## Features

- 📄 **Pure HTML** - No CSS frameworks, minimal JavaScript
- 🚀 **SEO Optimized** - Proper meta tags and semantic HTML
- 📱 **Responsive** - Works on all devices with native HTML
- ⚡ **Fast** - Minimal overhead, instant loading
- ♿ **Accessible** - Semantic HTML5 elements
- 📝 **JSON-Powered** - Easy post management via `posts.json`

## Structure

```
blog/
├── index.html           # Homepage (dynamically loads posts)
├── posts.json           # Blog post metadata
├── posts/              # Individual blog post HTML files
│   └── building-with-simplicity.html
└── README.md           # This file
```

## Getting Started

### View Locally

Use a local server (required for JSON loading):

```bash
# Using Python
python3 -m http.server 8000

# Using Node.js
npx serve

# Using PHP
php -S localhost:8000
```

Then visit `http://localhost:8000`

**Note:** Opening `index.html` directly in the browser won't work due to CORS restrictions when loading `posts.json`. You need to use a local server.

### Deployment

Deploy anywhere that serves static files:

- **GitHub Pages**: Push to GitHub and enable Pages
- **Netlify**: Drag and drop the folder
- **Vercel**: Connect and deploy
- **Any host**: Upload via FTP/SFTP

## Editing Posts Visually

```bash
python3 blog/edit.py    # opens http://localhost:8001
```

Open any post and edit it right on the page. Click into text to change it, use the toolbar (or ⌘B / ⌘I / ⌘K) for bold, italics and links, drag photos to reorder them, and hover a photo to remove it. **Save** (⌘S) writes the change into the post's `.html` file, so check `git diff` and commit as usual.

- Only the content inside `<article>` changes. Lines you didn't touch stay exactly as they were.
- Pasted text arrives as plain text.
- The map, stats and lightbox are switched off while editing.
- Titles, dates and descriptions shown in lists come from `posts.json` / `rides.json` / `urbex.json`, not the page.
- If the file changes on disk while you're editing (say, Claude edits it), Save refuses instead of overwriting. Reload to pick up the new version.

It only listens on `127.0.0.1`, and `edit.py` / `editor/` aren't shipped in the Docker image.

## Adding New Posts

### 1. Create the HTML file

Copy `posts/building-with-simplicity.html` as a template:

```bash
cp posts/building-with-simplicity.html posts/my-new-post.html
```

Edit the file:
- Update the `<head>` meta tags
- Update the title and content
- Keep the slug in the filename (e.g., `my-new-post`)

### 2. Add to posts.json

Edit `posts.json` and add your new post:

```json
{
  "title": "My New Post Title",
  "slug": "my-new-post",
  "date": "2025-12-19",
  "readTime": "5 min read",
  "description": "A brief description of your post.",
  "tags": ["Tag1", "Tag2"]
}
```

**Important:** The `slug` must match your HTML filename (without `.html`)

Then rebuild the generated files (RSS feed, sitemap, and the post lists baked
into `index.html` / `rides/index.html` so search engines see them without JS):

```bash
python3 generate_feed.py
```

## Adding a Ride

Rides are motorcycle trip posts with an interactive route map built from a GPX
file. They live in `rides/`, are listed in `rides.json`, and show up on the
homepage, at `/rides/` (with a map of every route), and in the RSS feed.

```bash
# Create a ride, then open rides/<slug>.html and write the story
uv run new_ride.py new \
  --title "PCH to Big Sur" \
  --gpx ~/Downloads/ride.gpx \
  --photos ~/Desktop/bigsur \
  --bike "Yamaha R1" \
  --description "Fog, switchbacks, and one very judgmental cow."

# Later: add more photos and/or swap in a refined GPX (your story is left alone)
uv run new_ride.py update pch-to-big-sur --photos ~/Desktop/more --gpx ~/Downloads/fixed.gpx

# Pick the hero photo (also the list thumbnail and social card)
uv run new_ride.py update pch-to-big-sur --cover 07.jpg
```

Videos (`.mp4`/`.mov`) dropped in the same `--photos` folder are transcoded with
ffmpeg to 1080p H.264 (HDR is converted to SDR), stripped of all metadata
including the GPS iPhones embed, and given a poster frame (`vNN.mp4` + `vNN.jpg`).
They're pinned on the map like photos. `.mp4` is tracked with Git LFS.

Photos are never cropped: the hero runs full width, and the gallery lays photos
out in rows of equal height, each sized by its own aspect ratio. The cover
defaults to the first photo; pass `--cover` (an original filename on `new`, or a
published name like `07.jpg` on `update`) to choose another.

**Privacy:** the repo and the asset bucket are public, and deleting a file
later doesn't remove it from git history or S3. So:

- Put places you don't want on the internet in `.private/zones.json` (gitignored,
  dockerignored). Points inside a zone are removed anywhere on the route, and
  each radius is randomized per ride:
  `[{"name": "home", "lat": 37.76, "lon": -122.43, "radius": 500}]`
- `--privacy` (default 400 m) also trims the start and finish. Use
  `--privacy 0` for rides between public places.
- The published GPX is rebuilt with track points only: no waypoints, names,
  device info or heart rate. `--strip-times` drops timestamps too.
- Photos are resized, HEIC becomes JPEG, and all EXIF/GPS is stripped. Photos
  are pinned on the map from their GPS or by matching their time to the GPX,
  but never inside a private zone or more than 1 km from the route.
- Keep raw GPX files in `.private/` too. Look at
  `assets/rides/<slug>/route.gpx` before you commit.

The map, stats and elevation profile are computed in the browser from the GPX
by `ride-map.js`. Any `<figure data-lat="…" data-lng="…">` becomes a photo pin.
Map tiles: OpenStreetMap, OpenTopoMap and Esri (no API keys).

### rides.json Format

- `title`, `slug`, `date`, `description`: same as posts
- `gpx` (string): path to the GPX, relative to the blog root
- `distanceMi` (number): shown in the list
- `cover` (string, optional): hero photo and thumbnail, relative to the blog root
- `bike` (string, optional)
- `tags` (array, optional)

## Adding an Urban Exploration Post

Urbex posts are about abandoned places. They live in `urbex/`, are listed in
`urbex.json`, and show up on the homepage, at `/urbex/` (with a map of every
spot), and in the RSS feed. Same photo/video handling and gallery as rides, but
**no exact locations, ever**: no GPX, no route, no photo pins.

```bash
# Create a post, then open urbex/<slug>.html and write the story
uv run new_urbex.py new \
  --title "Soviet barracks in Wittstock" \
  --area "Wittstock, Brandenburg, Germany" \
  --near 53.16,12.48 \
  --photos ~/Desktop/wittstock \
  --description "Lenin murals, collapsed floors and one very confused deer." \
  --tags "Germany, Brandenburg, Soviet"

# Later: add photos, pick the cover, or change the area (your story is left alone)
uv run new_urbex.py update soviet-barracks-in-wittstock --photos ~/Desktop/more
uv run new_urbex.py update soviet-barracks-in-wittstock --cover 04.jpg
uv run new_urbex.py update soviet-barracks-in-wittstock --near 53.17,12.49 --area "Near Wittstock, Germany"
```

- `--area` is the text under the title. Keep it town-level.
- `--near` should be the nearest **town**, not the spot. It's rounded to 2
  decimals (~1 km) and the page shows a ~3 km circle around it, never a pin.
  The urbex maps also stop zooming in at a regional level. Leave `--near` out
  and the post has no map (and no pin on the overview).
- Photos are re-encoded with all EXIF/GPS stripped; GPS in them is ignored.
  Videos are transcoded like rides (1080p, HDR→SDR, metadata stripped, poster).
- `--date` defaults to the first photo's date.
- Watch for location giveaways in the photos themselves (street signs, unique
  landmarks in the background) and in what you write.

### urbex.json Format

- `title`, `slug`, `date`, `description`, `tags`: same as rides
- `area` (string, optional): e.g. "Wittstock, Brandenburg, Germany"
- `lat`, `lon` (numbers, optional): town-level, 2 decimals
- `cover` (string, optional): hero photo and thumbnail, relative to the blog root

## posts.json Format

Each post object in the JSON array has:

- `title` (string) - The post title
- `slug` (string) - URL-friendly identifier (matches the HTML filename)
- `date` (string) - ISO date format (YYYY-MM-DD)
- `readTime` (string) - Estimated reading time
- `description` (string) - Brief summary for the homepage
- `tags` (array) - List of tag strings

Posts are displayed in the order they appear in the JSON file.

## SEO Optimized

Each page includes:
- ✅ Semantic HTML5 elements
- ✅ Proper heading hierarchy (single h1, h2, h3)
- ✅ Meta descriptions
- ✅ Keywords
- ✅ Viewport meta tag
- ✅ Time elements with datetime attributes

## Why This Approach?

- **No build process** - Just edit JSON and HTML
- **No dependencies** - Pure HTML + minimal JS
- **Easy to maintain** - All post metadata in one file
- **Works forever** - No breaking changes
- **Fast** - Minimal overhead
- **Flexible** - Easy to customize

---

Built with pure HTML and a touch of JavaScript
