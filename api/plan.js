// Entiende un texto dictado y lo convierte en pasos (Vercel AI Gateway, sin claves: token OIDC del proyecto).
const { PLAN_SYS, clean, context, auth, parseJSON, models, str } = require('./_ai');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).send('Usa POST');
  const a = auth(req); if (!a) return res.status(503).send('no hay token OIDC en la función');
  const b = req.body || {};
  const text = str(b.text, 1500); if (!text) return res.status(400).send('Sin texto');
  let last = '';
  for (const model of models('PA_AI_MODELS', 'google/gemini-2.5-flash,google/gemini-2.5-flash-lite,anthropic/claude-haiku-5.5,anthropic/claude-haiku-4.5')){
    try {
      const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(12000),
        headers: { 'Authorization': 'Bearer ' + a.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 1000,
          messages: [{ role: 'system', content: PLAN_SYS }, { role: 'user', content: `${context(b)}\n\nDictado: """${text}"""` }] })
      });
      if (!r.ok){ last = r.status + ' ' + (await r.text()).slice(0, 200); continue; }
      const j = await r.json();
      const steps = clean(parseJSON(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content).steps);
      if (!steps.length){ last = 'sin pasos'; continue; }
      return res.status(200).json({ steps, model });
    } catch (e) { last = String(e && e.message || e).slice(0, 200); }
  }
  return res.status(502).send('IA no disponible: ' + last);
};
