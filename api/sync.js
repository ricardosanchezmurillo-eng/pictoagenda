// Sincronización de PictoAgenda entre los móviles de la familia.
// Guarda los datos en Vercel Blob (privado), en una carpeta que solo se encuentra con el código familiar.
const { put, get } = require('@vercel/blob');
const crypto = require('crypto');

const ns = code => 'pa/' + crypto.createHash('sha256').update('pictoagenda:' + String(code).trim().toLowerCase()).digest('hex').slice(0, 40);
let MODE = process.env.PA_BLOB_ACCESS || null; // 'private' (recomendado) o 'public'
const isAccessErr = e => /access|private|public/i.test(String(e && (e.message || e)));

async function putBlob(path, body, opts){
  const tryMode = m => put(path, body, Object.assign({ access: m, addRandomSuffix: false, allowOverwrite: true }, opts));
  if (MODE) return tryMode(MODE);
  try { const r = await tryMode('private'); MODE = 'private'; return r; }
  catch (e) { if (!isAccessErr(e)) throw e; const r = await tryMode('public'); MODE = 'public'; return r; }
}
async function getBlob(path){
  const tryMode = m => get(path, { access: m, useCache: false });
  if (MODE) return tryMode(MODE);
  try { const r = await tryMode('private'); if (r) MODE = 'private'; return r; }
  catch (e) { if (!isAccessErr(e)) throw e; const r = await tryMode('public'); if (r) MODE = 'public'; return r; }
}
const readAll = async stream => Buffer.from(await new Response(stream).arrayBuffer());

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) return res.status(503).send('Falta conectar Vercel Blob al proyecto');
  const code = String(req.headers['x-family-code'] || '').trim();
  if (code.length < 8) return res.status(401).send('Código no válido');
  const base = ns(code);
  const a = String(req.query.a || '');
  try {
    if (a === 'doc' && req.method === 'GET') {
      const r = await getBlob(base + '/data.json');
      if (!r || r.statusCode !== 200) return res.status(200).json({ doc: null });
      return res.status(200).json({ doc: JSON.parse((await readAll(r.stream)).toString('utf8')) });
    }
    if (a === 'doc' && req.method === 'POST') {
      const doc = req.body && req.body.doc;
      if (!doc || typeof doc !== 'object') return res.status(400).send('Sin datos');
      await putBlob(base + '/data.json', JSON.stringify(doc), { contentType: 'application/json', cacheControlMaxAge: 60 });
      return res.status(200).json({ ok: true });
    }
    if (a === 'photo' && req.method === 'POST') {
      const { id, data, type } = req.body || {};
      if (!/^[a-z0-9_]{3,60}$/i.test(String(id || '')) || !data) return res.status(400).send('Foto no válida');
      await putBlob(`${base}/p/${id}.jpg`, Buffer.from(data, 'base64'), { contentType: /^image\//.test(type) ? type : 'image/jpeg' });
      return res.status(200).json({ ok: true });
    }
    if (a === 'photo' && req.method === 'GET') {
      const id = String(req.query.id || '');
      if (!/^[a-z0-9_]{3,60}$/i.test(id)) return res.status(400).send('Foto no válida');
      const r = await getBlob(`${base}/p/${id}.jpg`);
      if (!r || r.statusCode !== 200) return res.status(404).send('No está');
      res.setHeader('Content-Type', (r.blob && r.blob.contentType) || 'image/jpeg');
      return res.status(200).send(await readAll(r.stream));
    }
    return res.status(404).send('No existe');
  } catch (e) {
    console.error(e);
    return res.status(500).send('Error del almacenamiento: ' + String(e && e.message || e).slice(0, 160));
  }
};
