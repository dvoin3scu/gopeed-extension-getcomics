// GetComics resolver for Gopeed.
// - getcomics.org/dls/... (the "Main Server" button): follows the redirects to the
//   real file and uses its real name instead of the link token.
// - a post page (getcomics.org/<category>/<slug>): finds the download buttons and
//   picks a host by the "order" setting (Main Server, then Pixeldrain, then Mediafire).
// Mega is not supported (it fails through a VPN anyway).

var UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

gopeed.events.onResolve(async function (ctx) {
  var url = ctx.req.url;
  var files;
  if (isDlsLink(url)) {
    files = [await resolveDirect(url, url)];
  } else {
    files = await resolvePost(url);
  }
  if (!files.length) throw new Error('GetComics: no supported download link found on ' + url);
  ctx.res = files.length === 1
    ? { name: '', files: files }
    : { name: files.folder || '', files: files };
});

// ---------------------------------------------------------------- post pages
async function resolvePost(pageUrl) {
  var resp = await fetch(pageUrl, { headers: { 'User-Agent': UA } });
  if (!resp.ok) throw new Error('GetComics: page returned HTTP ' + resp.status);
  var html = await resp.text();
  var links = findLinks(html);

  var order = String(gopeed.settings.order || 'main,pixeldrain,mediafire')
    .toLowerCase().split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var all = gopeed.settings.allLinks !== false;

  for (var i = 0; i < order.length; i++) {
    var host = order[i];
    var picked = links.filter(function (l) { return l.host === host; });
    if (!picked.length) continue;
    if (!all) picked = picked.slice(0, 1);
    var files = [];
    for (var j = 0; j < picked.length; j++) {
      try {
        files.push(await resolveHost(picked[j], pageUrl));
      } catch (e) {
        gopeed.logger.warn('GetComics: ' + host + ' link failed: ' + e.message);
      }
    }
    files = dedupe(files);
    if (files.length) {
      if (files.length > 1) files.folder = sanitize(pageTitle(html) || 'GetComics');
      return files;
    }
  }
  return [];
}

// Every <a> on the page, classified by its title/text first, then by its href.
function findLinks(html) {
  var out = [];
  var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html))) {
    var attrs = m[1];
    var href = attr(attrs, 'href');
    if (!href) continue;
    href = decodeEntities(href);
    var label = (attr(attrs, 'title') + ' ' + stripTags(m[2])).toLowerCase();
    var host = classify(label, href);
    if (host) out.push({ host: host, href: href });
  }
  return out;
}

function classify(label, href) {
  var h = href.toLowerCase();
  if (/pixeldrain/.test(label) || /pixeldrain\.com\//.test(h)) return 'pixeldrain';
  if (/mediafire/.test(label) || /mediafire\.com\//.test(h)) return 'mediafire';
  if (/mega/.test(label) || /mega\.(nz|co\.nz)\//.test(h)) return 'mega';
  if (/(main server|download now|main download)/.test(label) && isDlsLink(h)) return 'main';
  if (/(main server|download now)/.test(label)) return 'main';
  return null;
}

async function resolveHost(link, referer) {
  if (link.host === 'main') return resolveDirect(link.href, referer);
  // Pixeldrain / Mediafire buttons can be GetComics redirect links: find the host URL first.
  var target = link.href;
  if (isDlsLink(target)) target = (await followRedirects(target, referer, true)).url;
  if (link.host === 'pixeldrain') return resolvePixeldrain(target);
  if (link.host === 'mediafire') return resolveMediafire(target);
  throw new Error('unsupported host ' + link.host);
}

// ------------------------------------------------------------ direct files
async function resolveDirect(url, referer) {
  var r = await followRedirects(url, referer, false);
  var name = r.name || basename(r.url);
  return fileInfo(name, r.size, r.url, referer);
}

// Follows redirects one hop at a time without downloading the file body.
// stopAtForeign: stop at the first URL outside getcomics (for Pixeldrain/Mediafire).
async function followRedirects(url, referer, stopAtForeign) {
  var current = url;
  for (var hop = 0; hop < 10; hop++) {
    if (stopAtForeign && hop > 0 && !/getcomics\.(org|info)/i.test(current)) {
      return { url: current };
    }
    var resp = await probe(current, referer);
    var loc = resp.headers.get('location');
    if (resp.status >= 300 && resp.status < 400 && loc) {
      current = absolute(loc, current);
      continue;
    }
    if (resp.status >= 400) throw new Error('HTTP ' + resp.status + ' on ' + current);
    return {
      url: current,
      name: dispositionName(resp.headers.get('content-disposition')),
      size: parseInt(resp.headers.get('content-length') || '0', 10) || 0
    };
  }
  throw new Error('too many redirects from ' + url);
}

// HEAD first; some servers reject it, so fall back to GET and drop the body.
async function probe(url, referer) {
  var headers = { 'User-Agent': UA, 'Referer': referer };
  var resp = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: headers });
  if (resp.status === 405 || resp.status === 403 || resp.status === 501) {
    resp = await fetch(url, { method: 'GET', redirect: 'manual', headers: headers });
    try { if (resp.body && resp.body.cancel) await resp.body.cancel(); } catch (e) { /* ignore */ }
  }
  return resp;
}

// ------------------------------------------------------------- Pixeldrain
async function resolvePixeldrain(url) {
  var m = /pixeldrain\.com\/(?:u|api\/file)\/([A-Za-z0-9]+)/.exec(url);
  if (!m) throw new Error('not a Pixeldrain file link: ' + url);
  var id = m[1];
  var info = await (await fetch('https://pixeldrain.com/api/file/' + id + '/info', { headers: { 'User-Agent': UA } })).json();
  if (!info || !info.name) throw new Error('Pixeldrain: no file info for ' + id);
  return fileInfo(info.name, info.size || 0, 'https://pixeldrain.com/api/file/' + id + '?download', null);
}

// -------------------------------------------------------------- Mediafire
async function resolveMediafire(url) {
  var resp = await fetch(url, { headers: { 'User-Agent': UA } });
  var html = await resp.text();
  var m = /href="(https?:\/\/download[^"]+mediafire\.com\/[^"]+)"/i.exec(html);
  if (!m) throw new Error('Mediafire: download button not found on ' + url);
  var direct = decodeEntities(m[1]);
  return fileInfo(basename(direct), 0, direct, url);
}

// ---------------------------------------------------------------- helpers
function fileInfo(name, size, url, referer) {
  var header = { 'User-Agent': UA };
  if (referer) header['Referer'] = referer;
  return { name: sanitize(name), size: size || 0, req: { url: url, extra: { header: header } } };
}

function isDlsLink(url) { return /getcomics\.(org|info)\/dls\//i.test(url); }

function attr(attrs, name) {
  var m = new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(attrs);
  return m ? (m[2] !== undefined ? m[2] : m[3]) : '';
}

function stripTags(s) { return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&#0*38;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x27;/gi, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#8211;/g, '-').replace(/&#8217;/g, "'").replace(/&nbsp;/g, ' ');
}

function pageTitle(html) {
  var m = /<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ||
          /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return '';
  return stripTags(m[1]).replace(/\s*[-|–]\s*GetComics.*$/i, '').trim();
}

function dispositionName(cd) {
  if (!cd) return '';
  var m = /filename\*\s*=\s*[^']*''([^;]+)/i.exec(cd);
  if (m) { try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')); } catch (e) { /* fall through */ } }
  m = /filename\s*=\s*"([^"]+)"/i.exec(cd) || /filename\s*=\s*([^;]+)/i.exec(cd);
  return m ? m[1].trim() : '';
}

function basename(url) {
  var path = url.split('#')[0].split('?')[0];
  var last = path.substring(path.lastIndexOf('/') + 1);
  try { last = decodeURIComponent(last.replace(/\+/g, ' ')); } catch (e) { /* keep raw */ }
  return last;
}

function absolute(loc, base) {
  if (/^https?:\/\//i.test(loc)) return loc;
  var origin = /^(https?:\/\/[^\/]+)/i.exec(base)[1];
  if (loc.indexOf('//') === 0) return base.split(':')[0] + ':' + loc;
  if (loc.charAt(0) === '/') return origin + loc;
  return base.substring(0, base.lastIndexOf('/') + 1) + loc;
}

function sanitize(name) {
  name = String(name || '').replace(/[\/\\:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) name = 'getcomics-download';
  return name;
}

function dedupe(files) {
  var seen = {};
  return files.filter(function (f) {
    if (seen[f.req.url]) return false;
    seen[f.req.url] = true;
    return true;
  });
}
