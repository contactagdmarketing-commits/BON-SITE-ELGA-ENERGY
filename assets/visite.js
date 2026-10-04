/* 04/10/2026 (James : « je veux pouvoir voir chaque visite […] c'est obligatoire car je ne sais pas si le
   scanner convertit bien ou pas »). Compteur de visites maison : une ligne par page vue dans la table
   site_visites (migration 0084), lue dans le CRM (Outils → Visites & entonnoir). Sans cookie, sans donnée
   personnelle : un jeton de session aléatoire (le même que le scanner, pour suivre visite → scan),
   la page, le site d'où l'on vient et la provenance du lien (partenaire, ref, canal, utm). */
(function () {
  try {
    if (location.hash === '#revoir') return;                       // duplicata affiché dans le CRM
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return; // pas de comptage en local
    var U = 'https://zqvocdmxpxkhknsgmijt.supabase.co';
    var K = 'sb_publishable_Yjplm_el8tlLJ_0xxvMB_g_XI8vStgr';
    var s = null;
    try {
      s = localStorage.getItem('elga_session');
      if (!s) { s = 'web-' + Date.now().toString(36) + '-' + Math.round(Math.random() * 1e6).toString(36); localStorage.setItem('elga_session', s); }
    } catch (_) { s = null; }
    var q = new URLSearchParams(location.search);
    var ref = '';
    try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (_) {}
    if (ref === location.hostname) ref = '';                      // navigation interne
    var row = {
      session: s,
      page: (location.pathname || '/').slice(0, 120),
      referrer: ref ? ref.slice(0, 120) : null,
      partenaire: (q.get('partenaire') || '').slice(0, 40) || null,
      ref: (q.get('ref') || q.get('parrain') || '').slice(0, 60) || null,
      canal: (q.get('canal') || '').slice(0, 40) || null,
      utm: (q.get('utm_source') || '').slice(0, 60) || null,
      appareil: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'ordinateur'
    };
    fetch(U + '/rest/v1/site_visites', {
      method: 'POST', keepalive: true,
      headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    }).catch(function () {});
  } catch (_) {}
})();
