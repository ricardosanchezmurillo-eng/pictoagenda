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
async function fromMapsUrl(u){
  try {
    const r = await get(u); let url = r.url;
    const cont = url.match(/[?&]continue=([^&]+)/); if (cont) url = decodeURIComponent(cont[1]);
    const name = (url.match(/\/place\/([^/@]+)/) || [])[1];
    const ll = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    return { name: name ? decodeURIComponent(name.replace(/\+/g, ' ')) : '', lat: ll && ll[1], lon: ll && ll[2] };
  } catch (e) { return null; }
}
async function photos(req, p, many){
  const urls = [];
  const add = u => { if (u && !urls.includes(u)) urls.push(u); };
  add(p.image);
  if (p.wikidata) add(await wikidataImage(p.wikidata));
  let website = p.website || null;
  if (website) add(await ogImage(website));
  if (p.lat && p.lon) (await commonsNear(p.lat, p.lon, p.name, !many)).forEach(add);
  add(await wikipedia(p.name, p.city));
  if (urls.length < 2){ website = website || await aiWebsite(req, p.name, p.city); if (website) add(await ogImage(website)); }
  const out = []; let total = 0;
  for (const u of urls){
    if (out.length >= (many ? 6 : 1)) break;
    const d = await imageData(u, many ? 900000 : 2500000); if (!d) continue;
    if (total + d.length > 3800000) break; total += d.length;
    out.push({ data: d, source: /wikimedia|wikipedia|wikidata/.test(u) ? 'Wikimedia' : /openstreetmap/.test(u) ? 'OpenStreetMap' : 'web del sitio' });
  }
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
      if (b.mapsUrl && /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl|(www\.)?google\.[a-z.]+\/maps)/.test(String(b.mapsUrl))){
        const m = await fromMapsUrl(String(b.mapsUrl)); if (!m || !m.lat) return res.status(404).send('No he podido leer ese enlace de Google Maps');
        const near = m.name ? (await search(m.name)).find(x => similar(m.name, x.name)) : null;
        p = Object.assign({}, near || {}, { name: m.name || (near && near.name) || 'sitio', lat: m.lat, lon: m.lon });
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
