(function () {
    document.querySelectorAll('[data-bnto-usermenu]').forEach(function (um) {
        if (um.dataset.bntoInit) return;
        um.dataset.bntoInit = '1';
        var btn = um.querySelector('.bnto-user-btn');
        btn.setAttribute('aria-haspopup', 'true');
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', function () {
            var open = um.classList.toggle('is-open');
            btn.setAttribute('aria-expanded', open);
        });
        um.querySelectorAll('.bnto-user-menu a').forEach(function (item) {
            item.addEventListener('click', function () {
                um.classList.remove('is-open');
                btn.setAttribute('aria-expanded', 'false');
            });
        });
    });
    if (document.documentElement.dataset.bntoUserDoc) return;
    document.documentElement.dataset.bntoUserDoc = '1';
    function closeAll(except) {
        document.querySelectorAll('[data-bnto-usermenu].is-open').forEach(function (um) {
            if (um === except) return;
            um.classList.remove('is-open');
            um.querySelector('.bnto-user-btn').setAttribute('aria-expanded', 'false');
        });
    }
    document.addEventListener('click', function (e) {
        closeAll(e.target.closest('[data-bnto-usermenu]'));
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeAll(null);
    });
})();