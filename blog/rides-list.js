// Renders ride rows (thumbnail + title + meta) from rides.json entries.
// `base` is the path prefix back to the blog root ('' or '../').
function renderRides(rides, container, base) {
    rides.forEach((ride) => {
        const a = document.createElement('a');
        a.className = 'ride-item';
        a.href = `${base}rides/${ride.slug}.html`;
        a.addEventListener('click', () => {
            if (typeof slurp === 'function') slurp('blog_ride_click', ride.slug);
        });

        if (ride.cover) {
            const img = document.createElement('img');
            img.className = 'ride-thumb';
            img.src = base + ride.cover;
            img.alt = '';
            img.loading = 'lazy';
            a.appendChild(img);
        }

        const text = document.createElement('div');
        const title = document.createElement('span');
        title.className = 'post-title';
        title.textContent = ride.title;
        text.appendChild(title);

        if (ride.description) {
            const desc = document.createElement('span');
            desc.className = 'post-desc';
            desc.textContent = ride.description;
            text.appendChild(desc);
        }

        const meta = document.createElement('span');
        meta.className = 'post-meta';
        const time = document.createElement('time');
        time.dateTime = ride.date;
        time.textContent = new Date(ride.date + 'T12:00:00').toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
        });
        meta.appendChild(time);
        const extras = [];
        if (ride.distanceMi) extras.push(`${Math.round(ride.distanceMi)} mi`);
        if (ride.bike) extras.push(ride.bike);
        if (extras.length) meta.appendChild(document.createTextNode(` · ${extras.join(' · ')}`));
        text.appendChild(meta);

        a.appendChild(text);
        container.appendChild(a);
    });
}
