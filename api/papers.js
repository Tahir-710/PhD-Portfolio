// Latest arXiv papers in the site owner's research areas.
// Runs on Vercel; the response is cached at the edge so arXiv is asked at most every few hours.
const MAT = '(cat:cond-mat.mtrl-sci OR cat:physics.app-ph OR cat:cond-mat.mes-hall OR cat:physics.chem-ph OR cat:physics.optics)';
// One paper per topic, newest first. Order here is the order on the page.
const TOPICS = [
  ['Perovskites', MAT + ' AND (abs:"halide perovskite" OR abs:"halide perovskites" OR abs:"perovskite thin film")'],
  ['Bismuth perovskites (MBI)',
    'abs:"methylammonium bismuth iodide" OR abs:MA3Bi2I9 OR abs:Cs3Bi2I9 OR (abs:bismuth AND abs:perovskite AND (abs:iodide OR abs:halide OR abs:bromide))'],
  ['Perovskite–silicon tandems', 'abs:perovskite AND abs:tandem AND (abs:silicon OR abs:Si OR abs:"c-Si")'],
  ['Quantum materials',
    '(abs:"quantum materials" OR abs:"quantum material" OR abs:"van der Waals heterostructure" OR abs:"2D semiconductor") AND (abs:optoelectronic OR abs:photocurrent OR abs:exciton OR abs:photodetector)'],
  ['Lithium-ion batteries', '(abs:"lithium-ion battery" OR abs:"lithium-ion batteries" OR abs:"Li-ion battery" OR abs:"Li-ion batteries") AND ' + MAT],
  ['Optoelectronics', MAT + ' AND (ti:optoelectronic OR ti:optoelectronics OR ti:photodetector OR ti:photodetectors)'],
  ['Polymers',
    '(abs:"conjugated polymer" OR abs:"conjugated polymers" OR abs:"polymer semiconductor" OR abs:"organic semiconductor") AND (abs:photodetector OR abs:optoelectronic OR abs:photovoltaic OR abs:"charge transport")'],
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
    out.push({
      title,
      authors: authors.length > 3 ? authors.slice(0, 3).join(', ') + ' et al.' : authors.join(', '),
      date: clean(tag(e, 'published')).slice(0, 10),
      url: 'https://arxiv.org/abs/' + idm[1],
    });
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function latest(query) {
  const url =
    'https://export.arxiv.org/api/query?search_query=' + encodeURIComponent(query) +
    '&sortBy=submittedDate&sortOrder=descending&max_results=4';
  const r = await fetch(url, {
    headers: { 'User-Agent': 'portfolio-reading-list/1.0 (https://tahir-sajjad-portfolio.vercel.app)' },
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw new Error('arXiv responded ' + r.status);
  return parse(await r.text());
}

module.exports = async (req, res) => {
  const papers = [];
  const seen = new Set();
  let lastError = null;
  for (let i = 0; i < TOPICS.length; i++) {
    const [topic, query] = TOPICS[i];
    if (i) await sleep(3000); // arXiv asks for one request every 3 seconds
    try {
      const pick = (await latest(query)).find((p) => !seen.has(p.url));
      if (pick) { seen.add(pick.url); papers.push({ ...pick, topic }); }
    } catch (err) { lastError = err; }
  }
  if (papers.length < 3) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String((lastError && lastError.message) || 'too few papers') });
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // fresh for 6 h at the edge; a stale copy is served while refreshing or if arXiv is down
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=21600, stale-while-revalidate=604800, stale-if-error=604800');
  res.status(200).send(JSON.stringify({ source: 'arXiv', fetched: new Date().toISOString(), papers }));
};
module.exports.parse = parse;
