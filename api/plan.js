// Entiende lo que se dicta y lo convierte en pasos de agenda, con IA (Vercel AI Gateway).
// Sin claves: usa el token OIDC que Vercel da a cada función. Si falla, la app usa sus reglas.
const SYS = `Eres el asistente de una agenda visual con pictogramas para una niña de 7 años con autismo que aprende a leer por sílabas.
Un adulto dicta en lenguaje natural lo que van a hacer. Conviértelo en una secuencia corta y clara de pasos.

Devuelve SOLO JSON con esta forma: {"steps":[...]}

Tipos de paso:
1) Momento del día: {"type":"time","time":"hoy"|"manana_dia"|"manana"|"mediodia"|"tarde"|"noche"}
   "mañana" como día siguiente = "manana_dia"; "por la mañana" = "manana". Ponlo justo antes de las actividades de ese momento y no lo repitas.
2) Actividad: {"type":"activity","label":"...","picto":"...","people":["..."],"cancelled":false,"reason":""}
   - label: lo más corto posible (1 a 3 palabras), en minúsculas, fácil de leer por sílabas: "cole", "desayunar", "coche", "parque", "casa de la abuela", "viene mamá".
   - picto: cómo se llama el pictograma en ARASAAC. Para acciones con objeto: verbo en infinitivo SIN "se" + artículo + sustantivo ("lavar las manos", "quitar los zapatos", "poner el pijama", "lavar los dientes"). Para el resto, una palabra: "colegio", "desayunar", "coche", "parque".
   - people: personas que van con ella o hacen la actividad con ella.
   - Si alguien viene a buscarla o la recoge: label "viene <persona>", picto "<persona>", people [].
   - Si NO va a pasar ("no hay cole", "hoy no vamos a la piscina"): "cancelled": true y "reason" con el motivo corto si lo dicen ("Eva está enferma").
3) Elegir: {"type":"choice","options":[{"label":"pintar","picto":"pintar"},{"label":"puzle","picto":"puzle"}]} cuando ella pueda elegir.

Reglas:
- Quita el relleno: "te voy a", "vamos a ir a", "para que", "allí", "luego", "después".
- Una frase puede dar varios pasos: "te llevo en el coche para que vayas a desayunar allí" → coche, desayunar.
- Mantén el orden en que se dicen las cosas. No inventes nada que no se haya dicho. Máximo 12 pasos.
- Si una persona o un lugar coincide con los conocidos, escríbelo exactamente igual.`;

const T_OK = new Set(['hoy', 'manana_dia', 'manana', 'mediodia', 'tarde', 'noche']);
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
function clean(steps){
  const out = [];
  for (const s of (steps || []).slice(0, 14)){
    if (!s || typeof s !== 'object') continue;
    if (s.type === 'time' && T_OK.has(s.time)) out.push({type:'time', time:s.time});
    else if (s.type === 'choice' && Array.isArray(s.options)){
      const o = s.options.map(x => ({label: str(x && x.label, 40).toLowerCase(), picto: str(x && x.picto, 40)})).filter(x => x.label).slice(0, 3);
      if (o.length >= 2) out.push({type:'choice', options:o});
    } else if (s.type === 'activity' && str(s.label, 60)){
      out.push({type:'activity', label: str(s.label, 60).toLowerCase(), picto: str(s.picto, 40),
        people: Array.isArray(s.people) ? s.people.map(p => str(p, 30)).filter(Boolean).slice(0, 4) : [],
        cancelled: !!s.cancelled, reason: str(s.reason, 80)});
    }
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).send('Usa POST');
  const token = process.env.AI_GATEWAY_API_KEY || req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN;
  if (!token) return res.status(503).send('no hay token OIDC en la función');
  const b = req.body || {};
  const text = str(b.text, 1500);
  if (!text) return res.status(400).send('Sin texto');
  const people = (Array.isArray(b.people) ? b.people : []).map(p => str(p, 30)).filter(Boolean).slice(0, 40);
  const places = (Array.isArray(b.places) ? b.places : []).map(p => str(p, 40)).filter(Boolean).slice(0, 80);
  const user = `Personas conocidas: ${people.join(', ') || '(ninguna)'}\nLugares y cosas conocidas: ${places.join(', ') || '(ninguno)'}\n\nDictado: """${text}"""`;
  const models = (process.env.PA_AI_MODELS || 'google/gemini-2.5-flash-lite,google/gemini-2.5-flash,anthropic/claude-haiku-5.5,anthropic/claude-haiku-4.5').split(',').map(m => m.trim()).filter(Boolean);
  let last = '';
  for (const model of models){
    try {
      const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 900,
          messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }] })
      });
      if (!r.ok){ last = r.status + ' ' + (await r.text()).slice(0, 200); continue; }
      const j = await r.json();
      const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      const m = String(txt).match(/\{[\s\S]*\}/);
      if (!m){ last = 'respuesta sin JSON'; continue; }
      const steps = clean(JSON.parse(m[0]).steps);
      if (!steps.length){ last = 'sin pasos'; continue; }
      return res.status(200).json({ steps, model });
    } catch (e) { last = String(e && e.message || e).slice(0, 200); }
  }
  return res.status(502).send('IA no disponible: ' + last);
};
