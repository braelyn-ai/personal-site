(function () {
    const saved = localStorage.getItem('theme');
    const theme = saved || 'light';
    document.documentElement.setAttribute('data-theme', theme);

    // The link names the mode it switches to
    const label = (current) => current === 'dark' ? 'light mode' : 'dark mode';

    // Every page but the homepage sits one folder down (posts/, rides/, urbex/, wall/, projects/)
    const SECTIONS = [['essays', 'posts'], ['notes', 'wall'], ['rides', 'rides'], ['urbex', 'urbex'], ['projects', 'projects']];

    function siteBar() {
        const here = location.pathname.split('/').filter(Boolean)[0];
        const bar = document.createElement('div');
        bar.className = 'site-bar';
        const name = document.createElement('a');
        name.className = 'site-name';
        name.href = '../';
        name.textContent = 'Braelyn Boynton';
        const nav = document.createElement('nav');
        nav.setAttribute('aria-label', 'Sections');
        SECTIONS.forEach(([text, dir]) => {
            const a = document.createElement('a');
            a.href = `../${dir}/`;
            a.textContent = text;
            if (dir === here) a.setAttribute('aria-current', 'page');
            nav.appendChild(a);
        });
        bar.append(name, nav);
        document.body.prepend(bar);
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!document.body.classList.contains('home')) siteBar();

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-toggle';
        btn.textContent = label(theme);

        btn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            btn.textContent = label(next);
        });

        // On the homepage it joins the key links in the bottom-left corner
        (document.querySelector('.key-links') || document.body).appendChild(btn);
    });
})();
