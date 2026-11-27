// Recibe el audio (WAV 16 kHz) y devuelve lo que se ha dicho y los pasos, con un modelo que entiende audio.
const { VOICE_SYS, clean, context, auth, parseJSON, models, str } = require('./_ai');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).send('Usa POST');
  const a = auth(req); if (!a) return res.status(503).send('no hay token OIDC en la función');
  const b = req.body || {};
  const audio = String(b.audio || '');
  if (audio.length < 2000 || audio.length > 4200000) return res.status(400).send('Audio no válido');
  const { generateText } = await import('ai');
  const { createGateway } = await import('@ai-sdk/gateway');
  const gw = createGateway({ apiKey: a.token, headers: { 'ai-gateway-auth-method': a.method } });
  let last = '';
  for (const model of models('PA_VOICE_MODELS', 'google/gemini-2.5-flash,google/gemini-2.5-flash-lite,google/gemini-3-flash')){
    try {
      const r = await generateText({
        model: gw(model), system: VOICE_SYS, temperature: 0, maxRetries: 1, maxOutputTokens: 1200, abortSignal: AbortSignal.timeout(20000),
        messages: [{ role: 'user', content: [
          { type: 'text', text: context(b) + '\n\nAudio del adulto:' },
          { type: 'file', data: audio, mediaType: 'audio/wav', filename: 'dictado.wav' }
        ]}]
      });
      const out = parseJSON(r.text);
      return res.status(200).json({ transcript: str(out.transcript, 1500), steps: clean(out.steps), model });
    } catch (e) { last = String(e && e.message || e).slice(0, 200); }
  }
  return res.status(502).send('IA de voz no disponible: ' + last);
};
