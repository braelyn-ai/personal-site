// "More in the log" under a post, ride or urbex entry: the four closest by shared tags, then newest
(function () {
    const match = window.location.pathname.match(/\/(posts|rides|urbex)\/([^/]+?)(\.html)?$/);
    if (!match) return;
    const [, section, slug] = match;

    fetch(`../${section}.json`)
        .then(r => r.json())
        .then(entries => {
            const current = entries.find(p => p.slug === slug);
            if (!current) return;

            const tags = new Set((current.tags || []).map(t => t.toLowerCase()));
            const shared = p => (p.tags || []).filter(t => tags.has(t.toLowerCase())).length;
            const picks = entries
                .filter(p => p.slug !== slug)
                .map(p => ({ p, n: shared(p) }))
                .sort((a, b) => b.n - a.n || b.p.date.localeCompare(a.p.date))
                .slice(0, 4)
                .map(x => x.p);
            if (!picks.length) return;

            const box = document.createElement('section');
            box.className = 'more-log';
            const h = document.createElement('h2');
            h.textContent = { posts: 'More essays', rides: 'More rides', urbex: 'More spots' }[section];
            const list = document.createElement('ul');
            picks.forEach(p => {
                const li = document.createElement('li');
                const time = document.createElement('time');
                time.dateTime = p.date;
                time.textContent = new Date(p.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
                const a = document.createElement('a');
                a.href = `${p.slug}.html`;
                a.textContent = p.title;
                li.append(time, a);
                list.appendChild(li);
            });
            box.append(h, list);
            (document.querySelector('main') || document.body).insertAdjacentElement('afterend', box);
        })
        .catch(() => {});
})();
