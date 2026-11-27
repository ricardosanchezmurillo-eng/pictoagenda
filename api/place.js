// Sitios reales: buscar el sitio (OpenStreetMap) y conseguir fotos (OpenStreetMap, Wikimedia Commons cerca del sitio,
// Wikipedia y la imagen de portada de su web). También entiende enlaces de Google Maps compartidos.
// Modos: {mode:'search', query} → lista de sitios · {mode:'photos', name, lat, lon, …} o {mapsUrl} → fotos · {name, city} → automático
const { auth } = require('./_ai');
const UA = 'PictoAgenda/1.0 (agenda visual familiar; https://github.com/ricardosanchezmurillo-eng/pictoagenda)';
const STOPW = ['el','la','los','las','de','del','y','and','en','a','al','centro','comercial','restaurante','teatro','parque'];
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
const words = s => norm(s).split(' ').filter(w => w.length > 1 && !STOPW.includes(w));
function similar(a, b){ const A = words(a), B = norm(b); if (!A.length) return false; const hit = A.filter(w => B.includes(w)).length; return hit / A.length >= 0.6 && B.includes(A[0]); }

const get = (url, opts = {}) => fetch(url, Object.assign({ headers: { 'User-Agent': UA, 'Accept-Language': 'es' }, signal: AbortSignal.timeout(7000), redirect: 'follow' }, opts));
async function json(url){ try { const r = await get(url); return r.ok ? await r.json() : null; } catch (e) { return null; } }
async function imageData(url, max){
  try {
    const r = await get(url, { headers: { 'User-Agent': UA, 'Accept': 'image/*' } });
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!r.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 4000 || buf.length > (max || 1500000)) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch (e) { return null; }
}
async function ogImage(site){
  try {
    if (!/^https?:\/\//.test(site)) site = 'https://' + site;
    const r = await get(site); if (!r.ok) return null;
    const html = (await r.text()).slice(0, 400000);
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/i);
    const c = m && m[0].match(/content=["']([^"']+)["']/i);
    return c ? new URL(c[1].replace(/&amp;/g, '&'), r.url).href : null;
  } catch (e) { return null; }
}
const filePath = (f, w) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=${w || 800}`;
async function wikidataImage(q){ const j = await json(`https://www.wikidata.org/wiki/Special:EntityData/${q}.json`);
  try { return filePath(j.entities[q].claims.P18[0].mainsnak.datavalue.value); } catch (e) { return null; } }
async function commonsNear(lat, lon, name, onlyMatching){
  const j = await json(`https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=400&gsnamespace=6&gslimit=20&format=json`);
  const files = ((j && j.query && j.query.geosearch) || []).map(x => x.title.replace(/^File:/, '')).filter(t => /\.(jpe?g|png|webp)$/i.test(t));
  const ws = words(name);
  files.sort((a, b) => ws.filter(w => norm(b).includes(w)).length - ws.filter(w => norm(a).includes(w)).length);
  return files.filter(f => !onlyMatching || ws.some(w => norm(f).includes(w))).slice(0, 4).map(f => filePath(f, 700));
}
async function wikipedia(name, city){
  const j = await json(`https://es.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent([name, city].filter(Boolean).join(' '))}&gsrlimit=4&prop=pageimages&piprop=thumbnail&pithumbsize=800&format=json`);
  const pages = Object.values((j && j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index);
  const p = pages.find(x => similar(name, x.title) && x.thumbnail); return p ? p.thumbnail.source : null;
}
async function aiWebsite(req, name, city){
  const a = auth(req); if (!a) return null;
  try {
    const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(9000),
      headers: { 'Authorization': 'Bearer ' + a.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'google/gemini-2.5-flash-lite', temperature: 0, max_tokens: 60, messages: [{ role: 'user',
        content: `¿Cuál es la web oficial de "${name}"${city ? ' en ' + city : ''}, España? Responde SOLO con la URL, o NONE si no la conoces con seguridad.` }] }) });
    const m = (((await r.json()).choices[0].message.content) || '').match(/https?:\/\/[^\s"'<>)]+/); return m ? m[0] : null;
  } catch (e) { return null; }
}
async function search(query){
  const list = await json(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&extratags=1&limit=8&countrycodes=es&viewbox=-4.6,41.2,-3.0,39.9`) || [];
  return list.map(x => ({ name: x.name || String(x.display_name).split(',')[0], address: String(x.display_name).split(',').slice(1, 4).join(',').trim(),
    lat: x.lat, lon: x.lon, kind: x.type, website: (x.extratags || {}).website || (x.extratags || {})['contact:website'] || '',
    wikidata: (x.extratags || {}).wikidata || '', image: (x.extratags || {}).image || '' }));
}
// Enlaces de Google Maps (maps.app.goo.gl, g.co/kgs, google.com/maps…): se siguen los saltos uno a uno
// y se saca el nombre y las coordenadas de la dirección final o de la propia página.
const BROWSER = 'Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const GOOGLE_RE = /^https?:\/\/([a-z0-9-]+\.)*(goo\.gl|g\.co|google\.[a-z.]+)(\/|$)/i;
function parseMaps(url){
  const out = {};
  let u = url; try { u = decodeURIComponent(url); } catch (e) {}
  const place = u.match(/\/maps\/place\/([^/@?]+)/); if (place) out.name = place[1].replace(/\+/g, ' ').trim();
  const q = u.match(/[?&](?:q|query|daddr|destination)=([^&]+)/);
  if (q){ const v = q[1].replace(/\+/g, ' ').trim();
    const c = v.match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
    if (c){ out.lat = c[1]; out.lon = c[2]; } else if (!out.name) out.name = v; }
  const ll = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || u.match(/[?&](?:ll|center|sll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (ll && !out.lat){ out.lat = ll[1]; out.lon = ll[2]; }
  return out;
}
function parseMapsHtml(html){
  const out = {};
  const t = html.match(/<meta[^>]+(?:property|itemprop)=["'](?:og:title|name)["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|itemprop)=["'](?:og:title|name)["']/i);
  if (t){ const n = t[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").split(/\s+·\s+|\s+-\s+(?:Buscar con )?Google/)[0].trim(); if (n && !/^google maps$/i.test(n)) out.name = n; }
  const a = html.match(/APP_INITIALIZATION_STATE=\[\[\[[-\d.e]+,(-?\d+\.\d+),(-?\d+\.\d+)\]/);
  if (a){ out.lon = a[1]; out.lat = a[2]; }
  const m = html.match(/https:\/\/www\.google\.[a-z.]+\/maps\/[^"'\\\s<>]+/);
  if (m) Object.assign(out, Object.assign(parseMaps(m[0].replace(/\\u0026/g, '&').replace(/&amp;/g, '&')), out));
  const s = html.match(/\[null,null,(-?\d{1,2}\.\d{4,}),(-?\d{1,3}\.\d{4,})\]/);
  if (s && !out.lat){ out.lat = s[1]; out.lon = s[2]; }
  return out;
}
async function fromMapsUrl(u){
  let url = u, found = {};
  for (let hop = 0; hop < 8 && url; hop++){
    const cont = url.match(/[?&]continue=([^&]+)/); if (cont) url = decodeURIComponent(cont[1]);
    found = Object.assign(parseMaps(url), found);
    if (found.lat && found.name) break;
    if (!GOOGLE_RE.test(url)) break;
    let r;
    try { r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(7000), headers: { 'User-Agent': BROWSER, 'Accept-Language': 'es-ES,es;q=0.9', 'Accept': 'text/html' } }); }
    catch (e) { break; }
    if (r.url && r.url !== url) found = Object.assign(parseMaps(r.url), found);
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc){ url = new URL(loc, url).href; continue; }
    if (!r.ok) break;
    const html = (await r.text().catch(() => '')).slice(0, 1500000);
    found = Object.assign(parseMapsHtml(html), found);
    const refresh = html.match(/http-equiv=["']refresh["'][^>]*url=([^"'>]+)/i) || html.match(/location(?:\.href)?\s*=\s*["']([^"']+)["']/);
    url = refresh ? new URL(refresh[1].replace(/&amp;/g, '&'), url).href : null;
  }
  return found;
}
// Openverse: fotos con licencia libre (Flickr, Wikimedia…), sin clave.
async function openverse(name, city){
  const j = await json(`https://api.openverse.org/v1/images/?q=${encodeURIComponent([name, city].filter(Boolean).join(' '))}&page_size=10&mature=false`);
  const ws = words(name);
  return ((j && j.results) || []).filter(x => ws.length && norm(x.title + ' ' + (x.tags || []).map(t => t.name).join(' ')).includes(ws[0]))
    .slice(0, 4).map(x => x.thumbnail || x.url).filter(Boolean);
}
// Búsqueda web con el AI Gateway (Exa y, si falla, Perplexity): páginas sobre el sitio y sus fotos de portada.
const SKIP = /(google\.|goo\.gl|facebook\.|fb\.com|instagram\.|tripadvisor\.|tiktok\.|x\.com|twitter\.)/i;
const BADIMG = /(logo|icon|favicon|sprite|avatar|placeholder|banner-ad|pixel|\.svg)/i;
function walk(o, out){
  if (!o || typeof o !== 'object') return out;
  if (Array.isArray(o)){ o.forEach(x => walk(x, out)); return out; }
  if (typeof o.url === 'string' && /^https?:/.test(o.url)) out.push({ url: o.url, title: String(o.title || ''), image: typeof o.image === 'string' ? o.image : '',
    images: ((o.extras && o.extras.imageLinks) || o.imageLinks || []).filter(x => typeof x === 'string') });
  Object.keys(o).forEach(k => { if (o[k] && typeof o[k] === 'object') walk(o[k], out); });
  return out;
}
async function webImages(req, name, city, many){
  const a = auth(req); if (!a) return [];
  let found = [];
  try {
    const { generateText } = await import('ai');
    const { createGateway } = await import('@ai-sdk/gateway');
    const gw = createGateway({ apiKey: a.token, headers: { 'ai-gateway-auth-method': a.method } });
    const q = [name, city].filter(Boolean).join(' ');
    const tries = [
      ['exa_search', () => gw.tools.exaSearch({ numResults: 8, userLocation: 'ES', contents: { extras: { imageLinks: 4 } } })],
      ['perplexity_search', () => gw.tools.perplexitySearch({ maxResults: 8, country: 'ES', maxTokensPerPage: 256 })]
    ];
    for (const [tname, make] of tries){
      for (const model of ['openai/gpt-5.4-nano', 'google/gemini-2.5-flash-lite']){
        try {
          const r = await generateText({ model: gw(model), maxRetries: 0, abortSignal: AbortSignal.timeout(12000), maxOutputTokens: 200,
            tools: { [tname]: make() }, toolChoice: { type: 'tool', toolName: tname },
            prompt: `Busca en la web el sitio "${q}" (España): su web oficial y páginas con fotos del local. Usa la herramienta con esa búsqueda.` });
          const parts = [].concat(r.toolResults || [], ...((r.steps || []).map(st => st.toolResults || [])));
          found = walk(parts.map(t => t.output || t.result), []);
          if (found.length) break;
        } catch (e) {}
      }
      if (found.length) break;
    }
  } catch (e) { return []; }
  const ws = words(name);
  const rel = found.filter(x => !SKIP.test(x.url) && ws.length && norm(x.title + ' ' + x.url.replace(/[-_./]/g, ' ')).includes(ws[0]));
  const urls = [];
  rel.forEach(x => [x.image].concat(x.images).forEach(u => { if (u && /^https?:/.test(u) && !BADIMG.test(u) && !urls.includes(u)) urls.push(u); }));
  const noImg = rel.filter(x => !x.image).slice(0, many ? 4 : 2);
  (await Promise.all(noImg.map(x => ogImage(x.url)))).forEach(u => { if (u && !BADIMG.test(u) && !urls.includes(u)) urls.push(u); });
  return urls.slice(0, many ? 8 : 3);
}
async function photos(req, p, many){
  const urls = [];
  const add = u => { if (u && !urls.includes(u)) urls.push(u); };
  add(p.image);
  const [wd, near, wp, ov] = await Promise.all([
    p.wikidata ? wikidataImage(p.wikidata) : null,
    p.lat && p.lon ? commonsNear(p.lat, p.lon, p.name, !many) : [],
    wikipedia(p.name, p.city),
    many ? openverse(p.name, p.city) : []
  ]);
  add(wd);
  let website = p.website || null;
  if (website) add(await ogImage(website));
  near.forEach(add); add(wp);
  if (urls.length < (many ? 4 : 1)) (await webImages(req, p.name, p.city, many)).forEach(add);
  ov.forEach(add);
  if (!urls.length){ website = website || await aiWebsite(req, p.name, p.city); if (website) add(await ogImage(website)); }
  const want = many ? 8 : 1;
  const datas = await Promise.all(urls.slice(0, many ? 14 : 4).map(u => imageData(u, many ? 700000 : 2500000)));
  const out = []; let total = 0;
  datas.forEach((d, i) => {
    if (!d || out.length >= want || total + d.length > 4200000) return; total += d.length;
    const u = urls[i];
    out.push({ data: d, source: /wikimedia|wikipedia|wikidata/.test(u) ? 'Wikimedia' : /openstreetmap/.test(u) ? 'OpenStreetMap' : /openverse|staticflickr|flickr/.test(u) ? 'Flickr' : 'web' });
  });
  const maps = p.lat && p.lon ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.name, p.city].filter(Boolean).join(', '))}`;
  return { images: out, maps, website };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).send('Usa POST');
  const b = req.body || {}; const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  try {
    if (b.mode === 'search'){
      const q = s(b.query, 160); if (q.length < 2) return res.status(400).send('Escribe el sitio');
      return res.status(200).json({ places: await search(q) });
    }
    if (b.mode === 'photos'){
      let p = { name: s(b.name, 100), city: s(b.city, 60), lat: s(b.lat, 20), lon: s(b.lon, 20), website: s(b.website, 300), wikidata: s(b.wikidata, 20), image: s(b.image, 400) };
      const link = String(b.mapsUrl || '').match(/https?:\/\/[^\s]+/);
      if (link){
        if (!GOOGLE_RE.test(link[0])) return res.status(400).send('Ese enlace no es de Google Maps');
        const m = await fromMapsUrl(link[0]);
        const hint = s(String(b.mapsUrl).replace(link[0], ''), 100);
        const name = m.name || hint;
        if (!name && !m.lat) return res.status(404).send('No he podido leer ese enlace. Escribe el nombre del sitio y pulsa Buscar.');
        let near = null;
        const short = name.split(',')[0].trim();
        if (name){ near = (await search(name)).find(x => similar(short, x.name)) || (short !== name ? (await search(short)).find(x => similar(short, x.name)) : null) || null;
          if (near && m.lat && Math.abs(near.lat - m.lat) + Math.abs(near.lon - m.lon) > 0.05) near = null; }
        p = Object.assign({}, near || {}, { name: short || (near && near.name) || 'sitio', city: near ? '' : 'Madrid' });
        if (m.lat){ p.lat = m.lat; p.lon = m.lon; }
        const r = await photos(req, p, true);
        return res.status(200).json(Object.assign({ name: p.name }, r, { maps: link[0] }));
      }
      const r = await photos(req, p, true);
      return res.status(200).json(Object.assign({ name: p.name }, r));
    }
    // Automático (al dictar): el primer sitio que coincide y una foto
    const name = s(b.name, 100), city = s(b.city, 60);
    if (name.length < 2) return res.status(400).send('Falta el nombre');
    const hit = (await search([name, city].filter(Boolean).join(', '))).find(x => similar(name, x.name))
      || (city ? (await search(name)).find(x => similar(name, x.name)) : null);
    const r = await photos(req, Object.assign({ name, city }, hit || {}), false);
    if (!r.images.length) return res.status(404).json({ maps: r.maps });
    return res.status(200).json({ image: r.images[0].data, source: r.images[0].source, maps: r.maps });
  } catch (e) { return res.status(500).send('Error buscando el sitio: ' + String(e && e.message || e).slice(0, 160)); }
};
