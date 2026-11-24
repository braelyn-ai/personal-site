(function () {
    const saved = localStorage.getItem('theme');
    const theme = saved || 'light';
    document.documentElement.setAttribute('data-theme', theme);

    // The link names the mode it switches to
    const label = (current) => current === 'dark' ? 'light mode' : 'dark mode';

    document.addEventListener('DOMContentLoaded', () => {
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
