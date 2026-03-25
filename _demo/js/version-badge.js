/**
 * Shows V MAJOR.MINOR.<rev> where <rev> comes from js/revision-embed.js (works on
 * file://) with optional refresh from revision.txt over http(s). GitHub commit
 * count from the REST API Link header for comparison tooltips.
 */
(function () {
  var COMMITS_API_URL =
    'https://api.github.com/repos/EnthusiastGuy/S.E.A.M-Audio-Audition/commits?per_page=1';
  var scriptSrc =
    document.currentScript && document.currentScript.src
      ? document.currentScript.src
      : window.location.href;
  var REVISION_TXT_URL = new URL('../revision.txt', scriptSrc).href;
  /** Editable: semantic version prefix; revision from revision-embed.js (and optionally revision.txt). */
  var VERSION_MAJOR_MINOR = '1.0';

  function parseLastPageFromLinkHeader(linkHeader) {
    if (!linkHeader || typeof linkHeader !== 'string') return null;
    var parts = linkHeader.split(',');
    for (var i = 0; i < parts.length; i++) {
      var trimmed = parts[i].trim().replace(/\s+/g, ' ');
      var m = trimmed.match(/^<([^>]+)>\s*;\s*rel="last"$/i);
      if (m) {
        var pageMatch = m[1].match(/[?&]page=(\d+)/i);
        if (pageMatch) return parseInt(pageMatch[1], 10);
      }
    }
    return null;
  }

  function parseRevisionFile(text) {
    var m = String(text || '')
      .replace(/^\uFEFF/, '')
      .trim()
      .match(/^\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  function getEmbeddedRevision() {
    var v = window.__SEAM_REVISION;
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  function canFetchLocalRevision() {
    var p = (window.location.protocol || '').toLowerCase();
    return p === 'http:' || p === 'https:';
  }

  function loadLocalRevision() {
    var embedded = getEmbeddedRevision();
    if (!canFetchLocalRevision()) {
      return Promise.resolve(embedded);
    }
    return fetch(REVISION_TXT_URL, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('revision txt');
        return r.text();
      })
      .then(parseRevisionFile)
      .then(function (fromTxt) {
        return fromTxt != null ? fromTxt : embedded;
      })
      .catch(function () {
        return embedded;
      });
  }

  function applyBadge(localRev, remoteRev) {
    var wrap = document.getElementById('app-version-wrap');
    var prefixEl = document.getElementById('app-version-prefix');
    var revEl = document.getElementById('app-version-rev');
    if (!wrap || !prefixEl || !revEl) return;

    prefixEl.textContent = 'V ' + VERSION_MAJOR_MINOR + '.';
    var revStr = localRev != null ? String(localRev) : '?';
    revEl.textContent = revStr;
    revEl.classList.remove('app-version-rev--behind');

    var title = '';
    var aria =
      'Application version ' + VERSION_MAJOR_MINOR + '.' + revStr;

    if (localRev == null) {
      title =
        'Missing or invalid revision. Ensure js/revision-embed.js defines window.__SEAM_REVISION.';
      aria = title;
    } else if (remoteRev == null) {
      title = 'Could not check the latest version on GitHub.';
      aria += '. ' + title;
    } else if (localRev === remoteRev) {
      title = 'You have the latest version.';
      aria += '. ' + title;
    } else if (localRev < remoteRev) {
      var n = remoteRev - localRev;
      revEl.classList.add('app-version-rev--behind');
      title =
        'You are behind the latest version by ' +
        n +
        ' commit' +
        (n === 1 ? '' : 's') +
        '. Commit count: ' + remoteRev + '.';
      aria += '. ' + title;
    } else {
      title =
        'This build reports a newer revision than the default branch on GitHub.';
      aria += '. ' + title;
    }

    wrap.setAttribute('title', title);
    wrap.setAttribute('aria-label', aria);
  }

  Promise.all([
    loadLocalRevision(),

    fetch(COMMITS_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then(function (res) {
        if (!res.ok) throw new Error('GitHub commits: ' + res.status);
        var lastPage = parseLastPageFromLinkHeader(res.headers.get('Link'));
        return lastPage != null ? lastPage : 1;
      })
      .catch(function () {
        return null;
      }),
  ]).then(function (pair) {
    applyBadge(pair[0], pair[1]);
  });
})();
