process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf-8');

console.clear();
console.log('\x1Bc');
console.log('\x1B[0m\x1B[38;5;239m \uD83E\uDF6E\x1B[0m\x1B[48;5;239m Starting... \x1B[0m\x1B[38;5;239m\uD83E\uDF6C\x1B[0m ');
const { createServer } = require('node:http'),
      { WebSocketServer } = require('ws'),
      express = require('express'),
      path = require('path'),
      fs = require('fs'),
      mm = require('music-metadata'),
      PORT = 4042;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const MEDICAMENT_BASE = 'https://medicament.ma';
const MEDICAMENT_LISTING = `${MEDICAMENT_BASE}/listing-des-medicaments/`;
const MEDICAMENT_LETTER_PATTERN = /[A-Z]/;
const catalogCache = {
  medications: null,
  detailBySlug: new Map(),
  inFlight: null
};

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  };

  return String(value).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }

    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }

    return named[entity] || match;
  });
}

function cleanText(value) {
  return decodeHtmlEntities(String(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function slugFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/|\/$/g, '').split('/').filter(Boolean).pop() || '';
  } catch {
    return String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^\/|\/$/g, '').split('/').filter(Boolean).pop() || '';
  }
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (PharmaSearch/1.0)',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }

  return response.text();
}

function parseLetterOptions(html) {
  const letters = [...html.matchAll(/href="https:\/\/medicament\.ma\/listing-des-medicaments\/\?lettre=([A-Z])"/g)]
    .map((match) => match[1]);

  return [...new Set(letters)];
}

function parsePageCount(html, letter) {
  const pattern = new RegExp(`/listing-des-medicaments/page/(\\d+)/\\?lettre=${letter}`, 'g');
  const pageNumbers = [...html.matchAll(pattern)].map((match) => Number(match[1]));
  return pageNumbers.length ? Math.max(...pageNumbers) : 1;
}

function parseListingItems(html, letter) {
  const items = [];
  const pattern = /<li class="listing-item">\s*<a href="([^"]+)">\s*<p class="primary">([\s\S]*?)<\/p>\s*<span class="secondary">([\s\S]*?)<\/span>\s*<\/a>\s*<\/li>/g;

  for (const match of html.matchAll(pattern)) {
    const url = match[1];
    const name = cleanText(match[2]);
    const secondary = cleanText(match[3]);
    const slug = slugFromUrl(url);
    const priceMatch = secondary.match(/PPV:\s*([0-9.,]+\s*dhs)/i);
    const labMatch = secondary.match(/-\s*([^-]+)$/);

    items.push({
      slug,
      url,
      letter,
      name,
      secondary,
      priceText: priceMatch ? priceMatch[1] : '',
      lab: labMatch ? cleanText(labMatch[1]) : '',
      image: `${MEDICAMENT_BASE}/image/${encodeURIComponent(slug)}/`
    });
  }

  return items;
}

function parseDetailFields(html) {
  const fields = {};
  const pattern = /<div class="detail-item">\s*<div class="detail-header">([\s\S]*?)<\/div>\s*<div class="detail-content">([\s\S]*?)<\/div>\s*<\/div>/g;

  for (const match of html.matchAll(pattern)) {
    const key = cleanText(match[1]);
    const value = cleanText(match[2]);
    fields[key] = value;
  }

  return fields;
}

function parseDetailPage(html, fallback) {
  const title = cleanText(
    html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ||
    html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ||
    fallback?.name ||
    'Medication'
  );
  const description = cleanText(
    html.match(/<meta name="description" content="([^"]+)"/)?.[1] ||
    html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] ||
    fallback?.secondary ||
    ''
  );
  const image = html.match(/https:\/\/medicament\.ma\/image\/[^"']+/)?.[0] || fallback?.image || '';
  const fields = parseDetailFields(html);
  const tags = [
    fields['Classe thérapeutique'],
    fields['Tableau'],
    fields['Remboursement'],
    fields['Code ATC'],
    fields['Nature']
  ].filter(Boolean);

  return {
    slug: fallback?.slug || slugFromUrl(fallback?.url || ''),
    url: fallback?.url || '',
    title,
    description,
    image,
    fields,
    tags: [...new Set(tags)]
  };
}

async function fetchCatalog() {
  if (catalogCache.medications) {
    return catalogCache.medications;
  }

  if (catalogCache.inFlight) {
    return catalogCache.inFlight;
  }

  catalogCache.inFlight = (async () => {
    const rootHtml = await fetchHtml(MEDICAMENT_LISTING);
    const letters = parseLetterOptions(rootHtml).filter((letter) => MEDICAMENT_LETTER_PATTERN.test(letter));
    const catalog = [];

    for (const letter of letters) {
      const firstPageHtml = await fetchHtml(`${MEDICAMENT_LISTING}?lettre=${letter}`);
      const pageCount = parsePageCount(firstPageHtml, letter);

      for (let page = 1; page <= pageCount; page += 1) {
        const pageUrl = page === 1
          ? `${MEDICAMENT_LISTING}?lettre=${letter}`
          : `${MEDICAMENT_LISTING}page/${page}/?lettre=${letter}`;
        const pageHtml = page === 1 ? firstPageHtml : await fetchHtml(pageUrl);
        const items = parseListingItems(pageHtml, letter);

        catalog.push(...items);
      }
    }

    const deduped = [...new Map(catalog.map((item) => [item.slug, item])).values()];
    catalogCache.medications = deduped;
    catalogCache.inFlight = null;
    return deduped;
  })().catch((error) => {
    catalogCache.inFlight = null;
    throw error;
  });

  return catalogCache.inFlight;
}

async function fetchDetailBySlug(slug) {
  if (catalogCache.detailBySlug.has(slug)) {
    return catalogCache.detailBySlug.get(slug);
  }

  const catalog = await fetchCatalog();
  const item = catalog.find((entry) => entry.slug === slug);

  if (!item) {
    throw new Error(`Unknown medication slug: ${slug}`);
  }

  const html = await fetchHtml(item.url);
  const detail = parseDetailPage(html, item);

  catalogCache.detailBySlug.set(slug, detail);
  return detail;
}

app.get('/api/medicaments', async (req, res) => {
  try {
    const medications = await fetchCatalog();
    res.json({
      count: medications.length,
      medications
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to load Moroccan medicine catalog.',
      message: error.message
    });
  }
});

app.get('/api/medicaments/:slug', async (req, res) => {
  try {
    const detail = await fetchDetailBySlug(req.params.slug);
    res.json(detail);
  } catch (error) {
    res.status(404).json({
      error: 'Medication not found.',
      message: error.message
    });
  }
});

app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'public', req.path);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.sendFile(filePath);
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    '\x1B[0m\x1B[38;5;2m \uD83E\uDF6E\x1B[0m\x1B[48;5;2;38;5;0m App running on \x1B[0m' +
    '\x1B[38;5;4;48;5;2m' +
    (server.address().address == '::' ? 'localhost' : server.address().address) + ':' + server.address().port +
    ` ${process.argv?.[2] === '--data-via-electron' ? '(via Electron) ' : ''}\x1B[0m\x1B[38;5;2m\uD83E\uDF6C\x1B[0m `
  );
});
function shutdown(sig) {
  console.log(`\x1B[38;5;1m \uD83E\uDF6E\x1B[0m\x1B[48;5;1;38;5;7m Detected ${sig}, exiting app... \x1B[0m\x1B[38;5;1m\uD83E\uDF6C\x1B[0m\n`);
  process.exit(0);
}
process.stdin.on('data', key => {
  if (key === '\x03' || key === '\x0F') shutdown(key === '\x03' ? 'SIGINT' : 'SIGTERM');
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

let lastMTime = null;
setInterval(() => {
  try {
    fs.readdirSync('.', {recursive: true}).forEach(item => {
      const { mtimeMs } = fs.statSync(item);
      if (lastMTime === null) {
        lastMTime = mtimeMs; return;
      }
      if (item.includes('node_modues')) return;
      if (mtimeMs > lastMTime) {
        lastMTime = mtimeMs;
        console.log(
          '\x1B[0m\x1B[38;5;220m \uD83E\uDF6E\x1B[0m\x1B[48;5;220;38;5;0m At \x1B[0m\x1B[48;5;220;38;5;5m ' +
          new Date().toISOString().match(/\d\d:\d\d:\d\d\.\d{3}/g)[0] + ' \x1B[0m' +
          '\x1B[48;5;214;38;5;0m Change for',
          fs.statSync(item).isFile() ? 'file' : 'folder',
          item
          + ' \x1B[0m\x1B[38;5;214m\uD83E\uDF6C\x1B[0m '
        );
        for (const c of wss.clients) {
          if (c.readyState === 1) c.send('reload');
        }
      }
    });
  } catch {}
}, 1000);

// =============================

app.get('/api/get-file', (req, res) => {
  const thisPath = req.query.path;
  res.send(fs.readFileSync(thisPath));
});
app.get('/api/song', async (req, res) => {
  const type = req.query.type;
  const filename = req.query.filename;
  const isExample = req.query.example == true;
  var result;
  var file = (filename && !isExample) ? await mm.parseFile(filename) : null;
  if (type === 'cover')
    result = file?.common?.picture?.[0]?.data || fs.readFileSync('./public/example.ico');
  if (type === 'title')
    result = file?.common?.title || (
      isExample ? 'Example' : path.basename(filename)
    );
  if (type === 'artist')
    result = file?.common?.artists?.map?.(
      (a, i, l) => (
        l.length === 1 ? a :
        (i + 1 === l.length ? `& ${a}` : `${a}${i + 2 === l.length ? '' : ','} `)
      )
    )?.join('') || (
      isExample ? 'User' : '<unknown>'
    );
  if (type === 'length')
    result = file?.format?.duration || (
      isExample ? 120 : -1
    );
  // console.log('cmd:', {type, filename}, '\n==> res:', result);
  res.send(result);
})
