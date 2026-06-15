const appState = {
  medications: [],
  filtered: [],
  activeSlug: null,
  query: "",
  ready: false,
  detailCache: new Map()
};

const elements = {
  searchInput: document.querySelector("#searchInput"),
  clearSearch: document.querySelector("#clearSearch"),
  statusPill: document.querySelector("#statusPill"),
  resultCount: document.querySelector("#resultCount"),
  medGrid: document.querySelector("#medGrid"),
  overviewScreen: document.querySelector("#overviewScreen"),
  detailScreen: document.querySelector("#detailScreen"),
  detailCard: document.querySelector("#detailCard"),
  backButton: document.querySelector("#backButton"),
  cardTemplate: document.querySelector("#medCardTemplate")
};

function hashToNumber(value) {
  let hash = 0;

  for (const char of String(value)) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000_007;
  }

  return Math.abs(hash);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function createBadgeImage(label, accentSeed) {
  const shortLabel = escapeXml(label.trim().slice(0, 2).toUpperCase() || "MA");
  const safeLabel = escapeXml(label);
  const hue = accentSeed % 360;
  const hueTwo = (hue + 42) % 360;
  const hueThree = (hue + 108) % 360;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="${safeLabel}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="hsl(${hue}, 80%, 58%)" />
          <stop offset="50%" stop-color="hsl(${hueTwo}, 72%, 52%)" />
          <stop offset="100%" stop-color="hsl(${hueThree}, 66%, 48%)" />
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="22" stdDeviation="20" flood-color="#000000" flood-opacity="0.28" />
        </filter>
      </defs>
      <rect width="800" height="600" rx="42" fill="url(#bg)" />
      <circle cx="590" cy="120" r="130" fill="#ffffff" fill-opacity="0.16" />
      <circle cx="140" cy="500" r="200" fill="#ffffff" fill-opacity="0.08" />
      <rect x="170" y="160" width="460" height="260" rx="130" fill="#ffffff" fill-opacity="0.2" filter="url(#shadow)" />
      <rect x="210" y="196" width="210" height="188" rx="94" fill="#ffffff" fill-opacity="0.94" />
      <rect x="380" y="196" width="210" height="188" rx="94" fill="#000000" fill-opacity="0.08" />
      <text x="400" y="520" text-anchor="middle" font-family="Arial, sans-serif" font-size="86" font-weight="700" fill="#ffffff" fill-opacity="0.96">${shortLabel}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildGridTags(medication) {
  const tags = [
    `Letter ${medication.letter}`,
    medication.lab,
    medication.priceText ? "PPV" : ""
  ].filter(Boolean);

  return [...new Set(tags)];
}

function buildDetailTags(detail, medication) {
  const tags = [
    medication.letter ? `Letter ${medication.letter}` : "",
    medication.lab || "",
    detail.fields?.["Classe thérapeutique"] || "",
    detail.fields?.Tableau || "",
    detail.fields?.Remboursement || "",
    detail.fields?.["Code ATC"] || ""
  ].filter(Boolean);

  return [...new Set(tags)];
}

function formatDetailText(detail, medication) {
  const parts = [];

  if (medication.secondary) {
    parts.push(medication.secondary);
  }

  if (detail.fields?.Présentation) {
    parts.push(`Présentation: ${detail.fields.Présentation}`);
  }

  if (detail.fields?.Composition) {
    parts.push(`Composition: ${detail.fields.Composition}`);
  }

  if (detail.fields?.["Classe thérapeutique"]) {
    parts.push(`Classe: ${detail.fields["Classe thérapeutique"]}`);
  }

  return parts.join(" • ");
}

function normalizeMedication(item) {
  const seed = hashToNumber(item.slug || item.url || item.name);

  return {
    ...item,
    image: createBadgeImage(item.name, seed),
    tags: buildGridTags(item)
  };
}

async function fetchCatalog() {
  const response = await fetch("/api/medicaments");

  if (!response.ok) {
    throw new Error("Unable to load Moroccan medications.");
  }

  const payload = await response.json();
  return (payload.medications || []).map(normalizeMedication);
}

async function fetchDetail(slug) {
  if (appState.detailCache.has(slug)) {
    return appState.detailCache.get(slug);
  }

  const response = await fetch(`/api/medicaments/${encodeURIComponent(slug)}`);

  if (!response.ok) {
    throw new Error("Unable to load medication detail.");
  }

  const detail = await response.json();
  appState.detailCache.set(slug, detail);
  return detail;
}

function setScreen(mode) {
  const isDetail = mode === "detail";

  elements.overviewScreen.classList.toggle("active", !isDetail);
  elements.detailScreen.classList.toggle("active", isDetail);
}

function renderSummary() {
  const total = appState.medications.length;
  const visible = appState.filtered.length;

  elements.resultCount.textContent = `${visible.toLocaleString()} of ${total.toLocaleString()} Moroccan medications shown`;

  if (!appState.ready) {
    elements.statusPill.textContent = "Loading Morocco catalog...";
  } else if (visible === 0) {
    elements.statusPill.textContent = "No matches";
  } else {
    elements.statusPill.textContent = "Moroccan catalog ready";
  }
}

function renderGrid() {
  elements.medGrid.innerHTML = "";

  if (!appState.ready) {
    elements.medGrid.innerHTML = `<div class="loading-state">Loading Moroccan medications...</div>`;
    return;
  }

  if (appState.filtered.length === 0) {
    elements.medGrid.innerHTML = `<div class="empty-state">No Moroccan medications matched your search.</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const medication of appState.filtered) {
    const card = elements.cardTemplate.content.cloneNode(true);
    const article = card.querySelector(".med-card");
    const image = card.querySelector(".med-image");
    const title = card.querySelector("h2");
    const description = card.querySelector(".med-description");
    const priceChip = card.querySelector(".price-chip");
    const tagRow = card.querySelector(".tag-row");

    article.dataset.slug = medication.slug;
    image.src = medication.image;
    image.alt = `${medication.name} visual`;
    title.textContent = medication.name;
    description.textContent = medication.secondary;
    priceChip.textContent = medication.priceText || "Price hidden";
    tagRow.innerHTML = medication.tags.map((tag) => `<span class="tag">${tag}</span>`).join("");

    article.addEventListener("click", () => openDetail(medication.slug));
    fragment.appendChild(card);
  }

  elements.medGrid.appendChild(fragment);
}

function renderDetail(summary, detail) {
  if (!summary || !detail) {
    elements.detailCard.innerHTML = `<div class="empty-state">Medication not found.</div>`;
    return;
  }

  const priceText = detail.fields?.PPV || summary.priceText || "Price unavailable";
  const tags = buildDetailTags(detail, summary);
  const summaryText = formatDetailText(detail, summary);
  const image = detail.image || summary.image;

  elements.detailCard.innerHTML = `
    <img class="detail-image" src="${image}" alt="${escapeXml(detail.title)} visual" />
    <div class="detail-copy">
      <div class="detail-title-row">
        <div>
          <p class="eyebrow">Medication detail</p>
          <h2>${escapeXml(detail.title)}</h2>
        </div>
        <div class="price-chip detail-price">${escapeXml(priceText)}</div>
      </div>

      <div class="detail-meta">
        <p>${escapeXml(detail.description || summary.secondary || "No description available.")}</p>
        <div class="detail-tags">
          ${tags.map((tag) => `<span class="tag">${escapeXml(tag)}</span>`).join("")}
        </div>
      </div>

      <div class="detail-meta">
        <p>${escapeXml(summaryText || "No extra summary available.")}</p>
      </div>
    </div>
  `;
}

function applyFilter() {
  const query = appState.query.trim().toLowerCase();

  if (!query) {
    appState.filtered = [...appState.medications];
    return;
  }

  appState.filtered = appState.medications.filter((medication) => {
    const haystack = [
      medication.name,
      medication.secondary,
      medication.lab,
      medication.priceText,
      medication.slug,
      medication.letter,
      ...(medication.tags || [])
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

function openDetail(slug) {
  const medication = appState.medications.find((item) => item.slug === slug);

  if (!medication) {
    return;
  }

  appState.activeSlug = slug;
  setScreen("detail");
  elements.detailCard.innerHTML = `<div class="loading-state">Loading medication detail...</div>`;
  window.location.hash = `med/${encodeURIComponent(slug)}`;
}

function openOverview() {
  appState.activeSlug = null;
  setScreen("overview");
  window.location.hash = "";
}

async function syncRoute() {
  const match = window.location.hash.match(/^#med\/(.+)$/);

  if (!match) {
    if (elements.detailScreen.classList.contains("active")) {
      setScreen("overview");
    }
    return;
  }

  const slug = decodeURIComponent(match[1]);
  const medication = appState.medications.find((item) => item.slug === slug);

  if (!medication) {
    return;
  }

  appState.activeSlug = slug;
  setScreen("detail");
  elements.detailCard.innerHTML = `<div class="loading-state">Loading medication detail...</div>`;

  try {
    const detail = await fetchDetail(slug);
    renderDetail(medication, detail);
  } catch (error) {
    elements.detailCard.innerHTML = `<div class="empty-state">Could not load the medication detail.</div>`;
    console.error(error);
  }
}

async function bootstrap() {
  try {
    const medications = await fetchCatalog();
    appState.medications = medications;
    appState.filtered = [...medications];
    appState.ready = true;
    renderSummary();
    renderGrid();
    await syncRoute();
  } catch (error) {
    appState.ready = true;
    appState.medications = [];
    appState.filtered = [];
    elements.statusPill.textContent = "Fetch failed";
    elements.resultCount.textContent = "Could not load Moroccan medications.";
    elements.medGrid.innerHTML = `
      <div class="empty-state">
        Live fetch failed. Check your connection or the Moroccan catalog endpoint and reload.
      </div>
    `;
    console.error(error);
  }
}

elements.searchInput.addEventListener("input", (event) => {
  appState.query = event.target.value;
  applyFilter();
  renderSummary();
  renderGrid();
});

elements.clearSearch.addEventListener("click", () => {
  appState.query = "";
  elements.searchInput.value = "";
  applyFilter();
  renderSummary();
  renderGrid();
  elements.searchInput.focus();
});

elements.backButton.addEventListener("click", openOverview);
window.addEventListener("hashchange", syncRoute);

applyFilter();
renderSummary();
renderGrid();
bootstrap();
