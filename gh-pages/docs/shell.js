const DOCS_SECTIONS = [
  {
    title: "Overview",
    items: [
      { title: "Fidra Docs", href: "index.html" }
    ]
  },
  {
    title: "Setup",
    items: [
      { title: "Files and Storage", href: "setup/files-and-storage.html" },
      { title: "Install Notes", href: "setup/install-notes.html" },
      { title: "Shared Folders in OneDrive and SharePoint", href: "setup/shared-folders.html" },
      { title: "Local Sync", href: "setup/local-sync.html" },
      { title: "Cloud Connect", href: "setup/cloud-connect.html" }
    ]
  },
  {
    title: "Workflows",
    items: [
      { title: "Date-Based Activities", href: "workflows/date-based-activities.html" },
      { title: "Personnel and Approvals", href: "workflows/personnel-and-approvals.html" },
      { title: "Planned Transactions", href: "workflows/planned-transactions.html" },
      { title: "Reports and Invoices", href: "workflows/reports-and-invoices.html" },
      { title: "Treasurer Handover", href: "workflows/treasurer-handover.html" }
    ]
  },
  {
    title: "Reference",
    items: [
      { title: "Keyboard Shortcuts", href: "reference/keyboard-shortcuts.html" }
    ]
  },
  {
    title: "Operations",
    items: [
      { title: "Backups and Restore", href: "operations/backups-and-restore.html" },
      { title: "Troubleshooting and Recovery", href: "operations/troubleshooting-and-recovery.html" }
    ]
  }
];

const DOCS_ITEMS = DOCS_SECTIONS.flatMap((section) =>
  section.items.map((item) => ({
    ...item,
    sectionTitle: section.title
  }))
);

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeDocPath(value) {
  return (value || "index.html").replace(/^\.?\//, "").replace(/\\/g, "/");
}

function inferSectionTitle(path) {
  if (path === "index.html") {
    return "Overview";
  }

  const folder = path.split("/")[0] || "";
  const match = DOCS_SECTIONS.find((section) => section.title.toLowerCase() === folder);
  if (match) {
    return match.title;
  }

  return "Documentation";
}

function rewriteInternalLinks(siteRoot) {
  const anchors = document.querySelectorAll("a[href]");

  for (const anchor of anchors) {
    const raw = anchor.getAttribute("href");
    if (!raw) continue;
    if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("#") || raw.startsWith("mailto:")) continue;

    const hashIndex = raw.indexOf("#");
    const base = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
    const hash = hashIndex >= 0 ? raw.slice(hashIndex) : "";

    let next = base;

    if (base.includes("gh-pages/")) {
      next = `${siteRoot}${base.split("gh-pages/").pop()}`;
    } else if (base.endsWith("README.md")) {
      next = `${base.slice(0, -9)}index.html`;
    } else if (base.endsWith(".md")) {
      next = `${base.slice(0, -3)}.html`;
    }

    anchor.setAttribute("href", `${next}${hash}`);
  }
}

function removeIndexBackLink(article) {
  const paragraphs = Array.from(article.querySelectorAll("p"));

  for (const paragraph of paragraphs) {
    const link = paragraph.querySelector("a[href]");
    if (!link) continue;

    if (paragraph.textContent.trim() === "Back to Docs Index") {
      paragraph.remove();
      return;
    }
  }
}

function getCurrentItem(pagePath) {
  return (
    DOCS_ITEMS.find((item) => item.href === pagePath) || {
      title: document.querySelector(".doc-content h1")?.textContent?.trim() || "Fidra Docs",
      href: pagePath,
      sectionTitle: inferSectionTitle(pagePath)
    }
  );
}

function setGroupOpen(group, shouldOpen) {
  const list = group.querySelector(".nav-group-list");
  const button = group.querySelector(".nav-group-toggle");
  if (!list || !button) return;

  group.classList.toggle("is-open", shouldOpen);
  list.hidden = !shouldOpen;
  button.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function updateExpandButton(groups, button) {
  if (!button) return;
  if (!groups.length) {
    button.textContent = "Expand all";
    button.dataset.mode = "expand";
    return;
  }

  const allOpen = groups.every((group) => group.classList.contains("is-open"));
  button.textContent = allOpen ? "Collapse all" : "Expand all";
  button.dataset.mode = allOpen ? "collapse" : "expand";
}

function buildSidebar(navRoot, currentItem, docsRoot) {
  const markup = DOCS_SECTIONS.map((section) => {
    const containsActive = section.items.some((item) => item.href === currentItem.href);
    const defaultOpen = containsActive || currentItem.href === "index.html";

    return `
      <section class="nav-group${defaultOpen ? " is-open" : ""}" data-nav-group data-contains-active="${containsActive ? "true" : "false"}">
        <button class="nav-group-toggle" type="button" data-nav-toggle aria-expanded="${defaultOpen ? "true" : "false"}">
          <span>${escapeHtml(section.title)}</span>
          <span class="nav-group-chevron" aria-hidden="true"></span>
        </button>
        <ul class="nav-group-list"${defaultOpen ? "" : " hidden"}>
          ${section.items
            .map((item) => {
              const isActive = item.href === currentItem.href;
              return `
                <li class="nav-item">
                  <a
                    class="nav-link${isActive ? " is-active" : ""}"
                    href="${docsRoot}${item.href}"
                    data-title="${escapeHtml(item.title.toLowerCase())}"
                    data-section="${escapeHtml(section.title.toLowerCase())}"
                  >
                    ${escapeHtml(item.title)}
                  </a>
                </li>
              `;
            })
            .join("")}
        </ul>
      </section>
    `;
  }).join("");

  navRoot.innerHTML = markup;
}

function setupSidebarControls() {
  const page = document.body;
  const openButtons = document.querySelectorAll("[data-sidebar-open]");
  const closeButtons = document.querySelectorAll("[data-sidebar-close]");
  const navRoot = document.querySelector("[data-doc-nav]");
  const filterInput = document.querySelector("[data-doc-filter]");
  const emptyState = document.querySelector("[data-doc-empty]");
  const expandButton = document.querySelector("[data-expand-all]");
  const groups = Array.from(document.querySelectorAll("[data-nav-group]"));

  function setSidebarOpen(isOpen) {
    page.classList.toggle("is-sidebar-open", isOpen);
    openButtons.forEach((button) => {
      button.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
  }

  function restoreSnapshots() {
    groups.forEach((group) => {
      if (!group.dataset.filterSnapshot) return;
      setGroupOpen(group, group.dataset.filterSnapshot === "true");
      delete group.dataset.filterSnapshot;
    });
  }

  function syncFilter(rawQuery) {
    const query = rawQuery.trim().toLowerCase();
    let visibleCount = 0;

    if (!query) {
      restoreSnapshots();
      groups.forEach((group) => {
        group.hidden = false;

        const items = group.querySelectorAll(".nav-link");
        items.forEach((item) => {
          item.parentElement.hidden = false;
        });
      });

      if (emptyState) {
        emptyState.hidden = true;
      }

      if (expandButton) {
        updateExpandButton(groups, expandButton);
      }
      return;
    }

    groups.forEach((group) => {
      if (!group.dataset.filterSnapshot) {
        group.dataset.filterSnapshot = group.classList.contains("is-open") ? "true" : "false";
      }

      const items = Array.from(group.querySelectorAll(".nav-link"));
      let groupMatches = 0;

      items.forEach((item) => {
        const haystack = `${item.dataset.title || ""} ${item.dataset.section || ""}`;
        const match = haystack.includes(query);
        item.parentElement.hidden = !match;
        if (match) {
          groupMatches += 1;
          visibleCount += 1;
        }
      });

      group.hidden = groupMatches === 0;
      setGroupOpen(group, groupMatches > 0);
    });

    if (emptyState) {
      emptyState.hidden = visibleCount > 0;
    }

    if (expandButton) {
      updateExpandButton(groups.filter((group) => !group.hidden), expandButton);
    }
  }

  openButtons.forEach((button) => {
    button.addEventListener("click", () => setSidebarOpen(true));
  });

  closeButtons.forEach((button) => {
    button.addEventListener("click", () => setSidebarOpen(false));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setSidebarOpen(false);
    }
  });

  navRoot?.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-nav-toggle]");
    if (toggle) {
      const group = toggle.closest("[data-nav-group]");
      if (!group) return;

      setGroupOpen(group, !group.classList.contains("is-open"));
      if (expandButton) {
        updateExpandButton(groups.filter((candidate) => !candidate.hidden), expandButton);
      }
      return;
    }

    const link = event.target.closest(".nav-link");
    if (!link) return;

    if (window.matchMedia("(max-width: 980px)").matches) {
      setSidebarOpen(false);
    }
  });

  expandButton?.addEventListener("click", () => {
    const visibleGroups = groups.filter((group) => !group.hidden);
    const shouldExpand = expandButton.dataset.mode !== "collapse";

    visibleGroups.forEach((group) => {
      const keepOpen = !shouldExpand && group.dataset.containsActive === "true";
      setGroupOpen(group, shouldExpand || keepOpen);
    });

    updateExpandButton(visibleGroups, expandButton);
  });

  filterInput?.addEventListener("input", (event) => {
    syncFilter(event.currentTarget.value);
  });

  updateExpandButton(groups, expandButton);
  syncFilter("");
}

function injectMeta(article, currentItem, docsRoot) {
  const heading = article.querySelector("h1");
  if (!heading) return;

  const meta = document.createElement("div");
  meta.className = "doc-meta";

  const trail = [
    `<a href="${docsRoot}index.html">Docs</a>`
  ];

  if (currentItem.sectionTitle && currentItem.sectionTitle !== "Overview") {
    trail.push(`<span>${escapeHtml(currentItem.sectionTitle)}</span>`);
  }

  meta.innerHTML = `
    <nav class="doc-breadcrumbs" aria-label="Breadcrumb">
      ${trail
        .map((item, index) =>
          index === 0 ? item : `<span class="doc-breadcrumb-sep">/</span>${item}`
        )
        .join("")}
    </nav>
    <p class="doc-section-label">${escapeHtml(currentItem.sectionTitle === "Overview" ? "Documentation" : currentItem.sectionTitle)}</p>
  `;

  article.insertBefore(meta, heading);
}

function buildPagination(root, currentItem, docsRoot) {
  if (!root) return;

  const currentIndex = DOCS_ITEMS.findIndex((item) => item.href === currentItem.href);
  if (currentIndex === -1) {
    root.innerHTML = "";
    return;
  }

  const previous = currentIndex > 0 ? DOCS_ITEMS[currentIndex - 1] : null;
  const next = currentIndex < DOCS_ITEMS.length - 1 ? DOCS_ITEMS[currentIndex + 1] : null;
  const items = [previous, next].filter(Boolean);

  if (items.length === 0) {
    root.innerHTML = "";
    return;
  }

  const card = (label, item) => `
    <a class="doc-pagination-link" href="${docsRoot}${item.href}">
      <span class="doc-pagination-label">${label}</span>
      <span class="doc-pagination-title">${escapeHtml(item.title)}</span>
      <span class="doc-pagination-section">${escapeHtml(item.sectionTitle)}</span>
    </a>
  `;

  root.innerHTML = `
    <div class="doc-pagination-grid${items.length === 1 ? " single" : ""}">
      ${previous ? card("Previous", previous) : ""}
      ${next ? card("Next", next) : ""}
    </div>
  `;
}

function initDocsShell() {
  const page = document.body;
  const docsRoot = page.dataset.docsRoot || "";
  const siteRoot = page.dataset.siteRoot || "";
  const pagePath = normalizeDocPath(page.dataset.docPath);
  const article = document.querySelector(".doc-content");
  const navRoot = document.querySelector("[data-doc-nav]");

  if (!article || !navRoot) return;

  rewriteInternalLinks(siteRoot);
  removeIndexBackLink(article);

  const currentItem = getCurrentItem(pagePath);
  buildSidebar(navRoot, currentItem, docsRoot);
  injectMeta(article, currentItem, docsRoot);
  buildPagination(document.querySelector("[data-doc-pagination]"), currentItem, docsRoot);
  setupSidebarControls();
}

document.addEventListener("DOMContentLoaded", initDocsShell);
