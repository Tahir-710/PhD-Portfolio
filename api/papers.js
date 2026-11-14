// Latest arXiv papers in the site owner's research areas.
// Runs on Vercel; the response is cached at the edge so arXiv is asked at most every few hours.
const QUERY =
  '(cat:cond-mat.mtrl-sci OR cat:physics.app-ph OR cat:cond-mat.mes-hall) AND (' +
  [
    'ti:photodetector',
    'ti:photodetectors',
    'abs:"perovskite photodetector"',
    'abs:"lead-free perovskite"',
    'abs:"bismuth halide"',
    'abs:"transient photocurrent"',
    'abs:"organic photodetector"',
    'abs:"perovskite thin film"',
    'abs:"solid-state battery"',
    'abs:"pulsed laser deposition"',
  ].join(' OR ') +
  ')';

const TOPICS = [
  ['Photodetectors', /photodetector|photodiode|photoresponse|photocurrent/i],
  ['Perovskites', /perovskite|bismuth halide/i],
  ['Energy storage', /batter(y|ies)|electrolyte|lithium|sodium-ion|supercapacitor/i],
  ['Thin-film growth', /pulsed laser deposition|thin film|epitax/i],
  ['Quantum materials', /quantum|topological|superconduct|2d material|van der waals/i],
];

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const clean = (s) => decode(s).replace(/\s+/g, ' ').trim();
const SUB = '₀₁₂₃₄₅₆₇₈₉';
// arXiv titles carry light LaTeX, e.g. MA$_3$Bi$_2$I$_9$
const untex = (s) =>
  s.replace(/\$([^$]*)\$/g, (m, x) =>
    x.replace(/_\{?(\d+)\}?/g, (n, d) => [...d].map((c) => SUB[c]).join(''))
     .replace(/\\(mathrm|rm|text|mathbf)\s*\{([^}]*)\}/g, '$2')
     .replace(/[{}]/g, ''));
const tag = (xml, name) => {
  const m = xml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
  return m ? m[1] : '';
};

function parse(xml) {
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const title = untex(clean(tag(e, 'title')));
    const summary = clean(tag(e, 'summary'));
    const id = clean(tag(e, 'id'));
    const idm = id.match(/arxiv\.org\/abs\/([\w.\/-]+?)(v\d+)?$/);
    if (!title || !idm) continue;
    const authors = [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((a) => clean(a[1]));
    const text = title + ' ' + summary;
    const topic = (TOPICS.find(([, re]) => re.test(text)) || ['Device physics'])[0];
    out.push({
      title,
      authors: authors.length > 3 ? authors.slice(0, 3).join(', ') + ' et al.' : authors.join(', '),
      date: clean(tag(e, 'published')).slice(0, 10),
      topic,
      url: 'https://arxiv.org/abs/' + idm[1],
    });
  }
  return out;
}

module.exports = async (req, res) => {
  try {
    const url =
      'https://export.arxiv.org/api/query?search_query=' + encodeURIComponent(QUERY) +
      '&sortBy=submittedDate&sortOrder=descending&max_results=12';
    const r = await fetch(url, {
      headers: { 'User-Agent': 'portfolio-reading-list/1.0 (https://tahir-sajjad-portfolio.vercel.app)' },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) throw new Error('arXiv responded ' + r.status);
    const papers = parse(await r.text()).slice(0, 6);
    if (!papers.length) throw new Error('no papers parsed');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // fresh for 6 h at the edge; a stale copy is served while refreshing or if arXiv is down
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=21600, stale-while-revalidate=604800, stale-if-error=604800');
    res.status(200).send(JSON.stringify({ source: 'arXiv', fetched: new Date().toISOString(), papers }));
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String((err && err.message) || err) });
  }
};
module.exports.parse = parse;
