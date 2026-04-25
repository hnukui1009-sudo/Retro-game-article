const state = {
  articles: [],
  query: "",
  activeTag: "",
};

const elements = {
  searchInput: document.getElementById("searchInput"),
  clearFiltersButton: document.getElementById("clearFiltersButton"),
  tagFilters: document.getElementById("tagFilters"),
  articles: document.getElementById("articles"),
  loadingState: document.getElementById("loadingState"),
  errorState: document.getElementById("errorState"),
  emptyState: document.getElementById("emptyState"),
  statusCount: document.getElementById("statusCount"),
  statusUpdated: document.getElementById("statusUpdated"),
};

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadArticles();
});

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  });

  elements.clearFiltersButton.addEventListener("click", () => {
    state.query = "";
    state.activeTag = "";
    elements.searchInput.value = "";
    renderTagFilters();
    render();
  });
}

async function loadArticles() {
  showLoading();

  try {
    const response = await fetch(`data/articles.json?ts=${Date.now()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("記事データの読み込みに失敗しました。");
    }

    const data = await response.json();
    state.articles = normalizeArticles(data);

    renderTagFilters();
    render();
  } catch (error) {
    showError(error instanceof Error ? error.message : "不明なエラーが発生しました。");
  }
}

function normalizeArticles(data) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((article) => normalizeArticle(article))
    .filter(Boolean)
    .sort((left, right) => {
      return Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
    });
}

function normalizeArticle(article) {
  if (!article || typeof article !== "object") {
    return null;
  }

  if (!article.title || !article.url || !article.sourceName) {
    return null;
  }

  return {
    title: String(article.title).trim(),
    url: String(article.url).trim(),
    sourceName: String(article.sourceName).trim(),
    publishedAt: toIsoDate(article.publishedAt),
    summary: article.summary ? String(article.summary).trim() : "概要はありません。",
    thumbnailUrl: article.thumbnailUrl ? String(article.thumbnailUrl).trim() : "",
    tags: Array.isArray(article.tags)
      ? [...new Set(article.tags.map((tag) => String(tag).trim()).filter(Boolean))]
      : [],
    fetchedAt: toIsoDate(article.fetchedAt),
  };
}

function toIsoDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

function getFilteredArticles() {
  return state.articles.filter((article) => {
    const matchesTag = !state.activeTag || article.tags.includes(state.activeTag);
    const searchTarget = [
      article.title,
      article.sourceName,
      article.summary,
      article.tags.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    const matchesQuery = !state.query || searchTarget.includes(state.query);

    return matchesTag && matchesQuery;
  });
}

function render() {
  const filteredArticles = getFilteredArticles();
  const lastUpdated = getLastUpdatedAt(state.articles);

  elements.statusCount.textContent = `${filteredArticles.length}件 / 全${state.articles.length}件`;
  elements.statusUpdated.textContent = lastUpdated
    ? formatDateTime(lastUpdated)
    : "まだ取得されていません";

  elements.loadingState.classList.add("hidden");
  elements.errorState.classList.add("hidden");

  if (!state.articles.length) {
    elements.emptyState.textContent = "まだ記事がありません。GitHub Actions または npm run fetch を実行してください。";
    elements.emptyState.classList.remove("hidden");
    elements.articles.replaceChildren();
    return;
  }

  if (!filteredArticles.length) {
    elements.emptyState.textContent = "条件に一致する記事がありません。";
    elements.emptyState.classList.remove("hidden");
    elements.articles.replaceChildren();
    return;
  }

  elements.emptyState.classList.add("hidden");
  elements.articles.replaceChildren(...filteredArticles.map(createArticleCard));
}

function renderTagFilters() {
  const fragment = document.createDocumentFragment();
  const allTags = getTagCounts(state.articles);

  fragment.appendChild(
    createTagButton({
      label: "すべて",
      count: state.articles.length,
      active: !state.activeTag,
      onClick: () => {
        state.activeTag = "";
        renderTagFilters();
        render();
      },
    }),
  );

  for (const { tag, count } of allTags) {
    fragment.appendChild(
      createTagButton({
        label: tag,
        count,
        active: state.activeTag === tag,
        onClick: () => {
          state.activeTag = state.activeTag === tag ? "" : tag;
          renderTagFilters();
          render();
        },
      }),
    );
  }

  elements.tagFilters.replaceChildren(fragment);
}

function getTagCounts(articles) {
  const counts = new Map();

  for (const article of articles) {
    for (const tag of article.tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.tag.localeCompare(right.tag, "ja");
    });
}

function createTagButton({ label, count, active, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `filter-chip${active ? " is-active" : ""}`;
  button.textContent = `${label} (${count})`;
  button.addEventListener("click", onClick);
  return button;
}

function createArticleCard(article) {
  const card = document.createElement("article");
  card.className = "article-card";

  const top = document.createElement("div");
  top.className = "card-top";

  const sourceRow = document.createElement("div");
  sourceRow.className = "card-source-row";

  const sourceBadge = document.createElement("span");
  sourceBadge.className = "source-badge";
  sourceBadge.textContent = article.sourceName;

  const publishedDate = document.createElement("time");
  publishedDate.className = "published-date";
  publishedDate.dateTime = article.publishedAt;
  publishedDate.textContent = formatDate(article.publishedAt);

  sourceRow.append(sourceBadge, publishedDate);

  const title = document.createElement("h2");
  title.className = "card-title";

  const titleLink = document.createElement("a");
  titleLink.href = article.url;
  titleLink.target = "_blank";
  titleLink.rel = "noopener noreferrer";
  titleLink.textContent = article.title;
  title.appendChild(titleLink);

  top.append(sourceRow, title);
  card.appendChild(top);

  if (article.thumbnailUrl) {
    const thumbnail = document.createElement("div");
    thumbnail.className = "card-thumbnail";

    const image = document.createElement("img");
    image.src = article.thumbnailUrl;
    image.alt = `${article.title} のサムネイル`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => thumbnail.remove());

    thumbnail.appendChild(image);
    card.appendChild(thumbnail);
  }

  const summary = document.createElement("p");
  summary.className = "card-summary";
  summary.textContent = article.summary;
  card.appendChild(summary);

  if (article.tags.length) {
    const tags = document.createElement("div");
    tags.className = "card-tags";

    for (const tag of article.tags) {
      const tagElement = document.createElement("span");
      tagElement.className = "card-tag";
      tagElement.textContent = tag;
      tags.appendChild(tagElement);
    }

    card.appendChild(tags);
  }

  const footer = document.createElement("div");
  footer.className = "card-footer";

  const fetchedAt = document.createElement("span");
  fetchedAt.className = "fetched-at";
  fetchedAt.textContent = `取得: ${formatDateTime(article.fetchedAt)}`;

  const linkButton = document.createElement("a");
  linkButton.className = "article-link";
  linkButton.href = article.url;
  linkButton.target = "_blank";
  linkButton.rel = "noopener noreferrer";
  linkButton.textContent = "記事を読む";

  footer.append(fetchedAt, linkButton);
  card.appendChild(footer);

  return card;
}

function getLastUpdatedAt(articles) {
  if (!articles.length) {
    return "";
  }

  return articles
    .map((article) => article.fetchedAt)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function showLoading() {
  elements.loadingState.classList.remove("hidden");
  elements.errorState.classList.add("hidden");
  elements.emptyState.classList.add("hidden");
}

function showError(message) {
  elements.loadingState.classList.add("hidden");
  elements.emptyState.classList.add("hidden");
  elements.errorState.textContent = message;
  elements.errorState.classList.remove("hidden");
}
