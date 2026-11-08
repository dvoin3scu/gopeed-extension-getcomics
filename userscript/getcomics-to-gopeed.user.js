// ==UserScript==
// @name         GetComics → Gopeed
// @namespace    https://github.com/dvoin3scu
// @version      0.1.0
// @description  One-click send of GetComics posts and Main Server links to the Gopeed server (resolved by the GetComics Gopeed extension).
// @match        https://getcomics.org/*
// @match        https://getcomics.info/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  var DEFAULT_SERVER = 'http://localhost:9900';

  function server() { return (GM_getValue('server', DEFAULT_SERVER) || DEFAULT_SERVER).replace(/\/+$/, ''); }
  function token() { return GM_getValue('token', ''); }

  GM_registerMenuCommand('Gopeed: set server URL', function () {
    var v = window.prompt('Gopeed server URL', server());
    if (v) GM_setValue('server', v.trim());
  });
  GM_registerMenuCommand('Gopeed: set API token', function () {
    var v = window.prompt('Gopeed API token (GOPEED_APITOKEN in the 01-downloads .env)', token());
    if (v !== null) GM_setValue('token', v.trim());
  });

  function api(method, path, body) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: method,
        url: server() + path,
        headers: { 'Content-Type': 'application/json', 'X-Api-Token': token() },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 60000,
        onload: function (r) {
          var json;
          try { json = JSON.parse(r.responseText); } catch (e) { return reject(new Error('HTTP ' + r.status)); }
          if (r.status >= 400 || (json.code && json.code !== 0)) return reject(new Error(json.msg || ('HTTP ' + r.status)));
          resolve(json.data);
        },
        onerror: function () { reject(new Error('cannot reach ' + server())); },
        ontimeout: function () { reject(new Error('timeout')); }
      });
    });
  }

  // resolve (runs the GetComics extension on the server) → create task
  async function send(url, button) {
    if (!token()) { window.alert('Set the Gopeed API token first (userscript menu → "Gopeed: set API token").'); return; }
    var label = button.textContent;
    button.textContent = '… Gopeed';
    button.disabled = true;
    try {
      var resolved = await api('POST', '/api/v1/resolve', { req: { url: url } });
      await api('POST', '/api/v1/tasks', { rid: resolved.id });
      var res = resolved.res || {};
      var name = res.name || (res.files && res.files[0] && res.files[0].name) || url;
      button.textContent = '✓ Gopeed';
      notify('Sent to Gopeed', name);
    } catch (e) {
      button.textContent = '✗ Gopeed';
      button.disabled = false;
      notify('Gopeed failed', e.message);
      console.error('[GetComics → Gopeed]', e);
    }
    setTimeout(function () { if (button.textContent !== label && !button.disabled) button.textContent = label; }, 8000);
  }

  function notify(title, text) {
    try { GM_notification({ title: title, text: text, timeout: 5000 }); } catch (e) { console.log(title, text); }
  }

  function makeButton(text, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.style.cssText = 'margin:4px 6px;padding:4px 10px;border:0;border-radius:4px;background:#4caf50;color:#fff;font:600 13px/1.4 sans-serif;cursor:pointer;';
    b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); onClick(b); });
    return b;
  }

  // Small button next to every Main Server (/dls/) link.
  var dls = document.querySelectorAll('a[href*="/dls/"]');
  dls.forEach(function (a) {
    a.insertAdjacentElement('afterend', makeButton('→ Gopeed', function (b) { send(a.href, b); }));
  });

  // On a post page with download links: one button for the whole post (best host by the extension's order).
  if (dls.length && document.querySelector('h1')) {
    var all = makeButton('⬇ Send post to Gopeed', function (b) { send(location.href.split('#')[0], b); });
    all.style.cssText += 'position:fixed;right:16px;bottom:16px;z-index:99999;padding:10px 14px;box-shadow:0 2px 8px rgba(0,0,0,.4);';
    document.body.appendChild(all);
  }
})();
