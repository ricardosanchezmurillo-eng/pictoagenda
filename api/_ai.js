// Utilidades compartidas de IA (los archivos que empiezan por _ no son rutas en Vercel).
const RULES = `Tipos de paso:
1) Momento del día: {"type":"time","time":"hoy"|"manana_dia"|"manana"|"mediodia"|"tarde"|"noche"}
   "mañana" como día siguiente = "manana_dia"; "por la mañana" = "manana". Ponlo justo antes de las actividades de ese momento y no lo repitas.
2) Actividad: {"type":"activity","label":"...","picto":"...","people":["..."],"cancelled":false,"reason":""}
   - label: lo más corto posible (1 a 4 palabras), en minúsculas, fácil de leer por sílabas: "cole", "desayunar", "coche", "parque", "colgar el abrigo", "viene mamá".
   - picto: cómo se llama el pictograma en ARASAAC. Para acciones con objeto: verbo habitual en infinitivo SIN "se" + artículo + sustantivo
     ("lavar las manos", "quitar los zapatos", "colgar el abrigo", "poner el pijama", "lavar los dientes", "recoger los juguetes").
     Usa el verbo más habitual: "poner el abrigo en la percha" → "colgar el abrigo"; "meter la ropa en la lavadora" → "poner la lavadora".
     Para el resto, una palabra: "colegio", "desayunar", "coche", "parque".
   - people: personas que van con ella o hacen la actividad con ella.
   - Si alguien viene a buscarla o la recoge: label "viene <persona>", picto "<persona>", people [].
   - Si NO va a pasar ("no hay cole", "hoy no vamos a la piscina"): "cancelled": true y "reason" con el motivo corto si lo dicen ("Eva está enferma").
3) Elegir: {"type":"choice","options":[{"label":"pintar","picto":"pintar"},{"label":"puzle","picto":"puzle"}]} cuando ella pueda elegir.

Reglas:
- Quita el relleno: "te voy a", "vamos a ir a", "para que", "allí", "luego", "después".
- Una frase puede dar varios pasos: "te llevo en el coche para que vayas a desayunar allí" → coche, desayunar.
- Mantén el orden en que se dicen las cosas. No inventes nada que no se haya dicho. Máximo 12 pasos.
- Si una persona o un lugar coincide con los conocidos, escríbelo exactamente igual.`;

const INTRO = `Eres el asistente de una agenda visual con pictogramas para una niña de 7 años con autismo que aprende a leer por sílabas.
Un adulto dice en lenguaje natural lo que van a hacer. Conviértelo en una secuencia corta y clara de pasos.`;

const PLAN_SYS = `${INTRO}\n\nDevuelve SOLO JSON con esta forma: {"steps":[...]}\n\n${RULES}`;
const VOICE_SYS = `${INTRO}
Recibes un audio en español de España. Primero transcribe con exactitud lo que dice el adulto, con buena puntuación,
corrigiendo solo errores evidentes de pronunciación (usa los nombres de personas y lugares conocidos si suenan parecido).
Después conviértelo en pasos.

Devuelve SOLO JSON con esta forma: {"transcript":"...","steps":[...]}
Si el audio está vacío o no se entiende, devuelve {"transcript":"","steps":[]}.

${RULES}`;

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
      out.push({type:'activity', label: str(s.label, 60).toLowerCase(), picto: str(s.picto, 50),
        people: Array.isArray(s.people) ? s.people.map(p => str(p, 30)).filter(Boolean).slice(0, 4) : [],
        cancelled: !!s.cancelled, reason: str(s.reason, 80)});
    }
  }
  return out;
}
function context(body){
  const people = (Array.isArray(body.people) ? body.people : []).map(p => str(p, 30)).filter(Boolean).slice(0, 40);
  const places = (Array.isArray(body.places) ? body.places : []).map(p => str(p, 40)).filter(Boolean).slice(0, 80);
  return `Personas conocidas: ${people.join(', ') || '(ninguna)'}\nLugares y cosas conocidas: ${places.join(', ') || '(ninguno)'}`;
}
function auth(req){
  if (process.env.AI_GATEWAY_API_KEY) return {token: process.env.AI_GATEWAY_API_KEY, method: 'api-key'};
  const t = req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN;
  return t ? {token: t, method: 'oidc'} : null;
}
function parseJSON(txt){ const m = String(txt || '').match(/\{[\s\S]*\}/); if (!m) throw new Error('respuesta sin JSON'); return JSON.parse(m[0]); }
const models = (env, def) => (process.env[env] || def).split(',').map(m => m.trim()).filter(Boolean);

module.exports = { PLAN_SYS, VOICE_SYS, clean, context, auth, parseJSON, models, str };
