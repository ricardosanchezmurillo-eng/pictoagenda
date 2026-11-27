// Busca una foto representativa de un sitio real (centro comercial, teatro, restaurante…) en fuentes abiertas:
// OpenStreetMap (foto, Wikidata o web oficial) → Wikipedia → web oficial que conozca la IA (imagen de portada og:image).
const { auth } = require('./_ai');
const UA = 'PictoAgenda/1.0 (agenda visual familiar; https://github.com/ricardosanchezmurillo-eng/pictoagenda)';
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
const words = s => norm(s).split(' ').filter(w => w.length > 1 && !['el','la','los','las','de','del','y','centro','comercial','restaurante','teatro'].includes(w));
const similar = (a, b) => { const A = words(a), B = norm(b); return A.length && A.every(w => B.includes(w)); };

async function get(url, opts = {}){
  return fetch(url, Object.assign({ headers: { 'User-Agent': UA, 'Accept-Language': 'es' }, signal: AbortSignal.timeout(7000), redirect: 'follow' }, opts));
}
async function imageData(url){
  if (!url) return null;
  try {
    const r = await get(url, { headers: { 'User-Agent': UA, 'Accept': 'image/*' } });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\/(jpeg|png|webp|gif|avif)/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 4000 || buf.length > 3500000) return null;
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
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
async function commonsFromWikidata(q){
  try {
    const j = await (await get(`https://www.wikidata.org/wiki/Special:EntityData/${q}.json`)).json();
    const f = j.entities[q].claims.P18[0].mainsnak.datavalue.value;
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=900`;
  } catch (e) { return null; }
}
async function fromOSM(name, city){
  try {
    const q = encodeURIComponent([name, city].filter(Boolean).join(', '));
    const list = await (await get(`https://nominatim.openstreetmap.org/search?q=${q}&format=jsonv2&extratags=1&limit=5&countrycodes=es&viewbox=-4.6,41.2,-3.0,39.9`)).json();
    const hit = (list || []).find(x => similar(name, x.name || x.display_name)) || null;
    if (!hit) return null;
    const t = hit.extratags || {};
    const out = { lat: hit.lat, lon: hit.lon, website: t.website || t['contact:website'] || null };
    out.imageUrl = t.image || (t.wikidata && await commonsFromWikidata(t.wikidata)) || (out.website && await ogImage(out.website)) || null;
    return out;
  } catch (e) { return null; }
}
async function fromWikipedia(name, city){
  try {
    const q = encodeURIComponent([name, city].filter(Boolean).join(' '));
    const j = await (await get(`https://es.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${q}&gsrlimit=4&prop=pageimages&piprop=thumbnail&pithumbsize=900&format=json`)).json();
    const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index);
    const p = pages.find(x => similar(name, x.title) && x.thumbnail);
    return p ? p.thumbnail.source : null;
  } catch (e) { return null; }
}
async function siteFromAI(req, name, city, kind){
  const a = auth(req); if (!a) return null;
  try {
    const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(9000),
      headers: { 'Authorization': 'Bearer ' + a.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'google/gemini-2.5-flash-lite', temperature: 0, max_tokens: 60, messages: [
        { role: 'user', content: `¿Cuál es la web oficial de "${name}"${kind ? ' (' + kind + ')' : ''}${city ? ' en ' + city : ''}, España? Responde SOLO con la URL o con NONE si no la conoces con seguridad.` }] }) });
    const t = ((await r.json()).choices[0].message.content || '').trim();
    const m = t.match(/https?:\/\/[^\s"'<>]+/); return m ? m[0] : null;
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).send('Usa POST');
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80), city = String(b.city || '').trim().slice(0, 60), kind = String(b.kind || '').trim().slice(0, 40);
  if (name.length < 2) return res.status(400).send('Falta el nombre');
  let source = null, image = null, website = null, lat = null, lon = null;
  const osm = await fromOSM(name, city);
  if (osm){ lat = osm.lat; lon = osm.lon; website = osm.website; if (osm.imageUrl && (image = await imageData(osm.imageUrl))) source = 'OpenStreetMap'; }
  if (!image){ const w = await fromWikipedia(name, city); if (w && (image = await imageData(w))) source = 'Wikipedia'; }
  if (!image){ website = website || await siteFromAI(req, name, city, kind); const og = website && await ogImage(website); if (og && (image = await imageData(og))) source = 'web oficial'; }
  const maps = lat && lon ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, city].filter(Boolean).join(', '))}`;
  if (!image) return res.status(404).json({ maps, website });
  return res.status(200).json({ image, source, website, maps });
};
