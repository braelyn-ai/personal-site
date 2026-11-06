// Dynamically generates the sidebar bio (top-left) + similar posts (bottom-left)
(function () {
    const match = window.location.pathname.match(/\/(posts|rides)\/([^/]+?)(\.html)?$/);
    if (!match) return;
    const isRide = match[1] === 'rides';
    const slug = match[2];

    fetch(isRide ? '../rides.json' : '../posts.json')
        .then(r => r.json())
        .then(posts => {
            const current = posts.find(p => p.slug === slug);
            if (!current) return;

            // Bio sidebar (top-left)
            const bio = document.createElement('aside');
            bio.className = 'sidebar-bio';

            const photoLink = document.createElement('a');
            photoLink.href = '../';
            const photo = document.createElement('img');
            photo.src = '../assets/me.jpg';
            photo.alt = 'Braelyn Boynton';
            photo.className = 'sidebar-photo';
            photoLink.appendChild(photo);
            bio.appendChild(photoLink);

            const nameLink = document.createElement('a');
            nameLink.href = '../';
            nameLink.className = 'sidebar-name';
            nameLink.textContent = 'Braelyn Boynton';
            bio.appendChild(nameLink);

            const desc = document.createElement('p');
            desc.className = 'sidebar-desc';
            desc.textContent = 'Building cool shit, dancing in warehouses, motorcycles, planes and adrenaline sports.';
            bio.appendChild(desc);

            const links = document.createElement('nav');
            links.className = 'sidebar-links';
            [
                ['X', 'https://x.com/braelyn_ai'],
                ['GitHub', 'https://github.com/braelyn-ai'],
                ['LinkedIn', 'https://www.linkedin.com/in/braelyn-ai/'],
                ['Instagram', 'https://www.instagram.com/braelyn.b__'],
            ].forEach(([label, url]) => {
                const a = document.createElement('a');
                a.href = url;
                a.textContent = label;
                links.appendChild(a);
            });
            bio.appendChild(links);

            // Append after footer so they flow below content on small screens
            const footer = document.querySelector('footer');
            footer.insertAdjacentElement('afterend', bio);

            // Related posts sidebar (bottom-left)
            const currentTags = new Set((current.tags || []).map(t => t.toLowerCase()));
            const others = posts.filter(p => p.slug !== slug);

            const scored = others.map(p => {
                const shared = (p.tags || []).filter(t => currentTags.has(t.toLowerCase())).length;
                return { post: p, shared };
            });

            scored.sort((a, b) => b.shared - a.shared || new Date(b.post.date) - new Date(a.post.date));

            const toShow = scored.slice(0, 4);
            if (toShow.length > 0) {
                const hasSimilar = toShow[0].shared > 0;

                const sidebar = document.createElement('aside');
                sidebar.className = 'post-sidebar';

                const heading = document.createElement('h4');
                heading.textContent = isRide ? 'More Rides' : hasSimilar ? 'Similar Posts' : 'Recent Posts';
                sidebar.appendChild(heading);

                const list = document.createElement('ul');
                toShow.forEach(({ post }) => {
                    const li = document.createElement('li');
                    const a = document.createElement('a');
                    a.href = `${post.slug}.html`;
                    a.textContent = post.title;
                    li.appendChild(a);

                    const date = document.createElement('span');
                    date.className = 'sidebar-date';
                    date.textContent = new Date(post.date + 'T12:00:00').toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                    });
                    li.appendChild(date);

                    list.appendChild(li);
                });

                sidebar.appendChild(list);
                bio.insertAdjacentElement('afterend', sidebar);
            }
        })
        .catch(() => {});
})();
