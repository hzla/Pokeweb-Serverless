// Browser-only teaching aids. This page never reads or modifies a ROM or save.
(() => {
  const headings = [...document.querySelectorAll("main section[id] > h2")];
  const sections = headings.map((h) => ({
    id: h.parentElement.id,
    title: h.childNodes[0].textContent.trim(),
  }));
  const jump = document.querySelector("#jump");
  const toc = document.querySelector("#page-toc");
  for (const section of sections) {
    const option = document.createElement("option");
    option.value = section.id;
    option.textContent = section.title;
    jump.append(option);
    const a = document.createElement("a");
    a.href = "#" + section.id;
    a.textContent = section.title;
    toc.append(a);
  }
  jump.addEventListener("change", () => {
    if (jump.value) location.hash = jump.value;
  });
  const menu = document.querySelector("#mobile-menu");
  menu.addEventListener("click", () => {
    const open = document.body.classList.toggle("menu-open");
    menu.setAttribute("aria-expanded", String(open));
  });
  document.querySelectorAll("#chapter-nav a").forEach((a) =>
    a.addEventListener("click", () => {
      document.body.classList.remove("menu-open");
      menu.setAttribute("aria-expanded", "false");
    }),
  );
  const storage = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* File/private contexts may restrict storage. */
      }
    },
  };
  const theme = document.querySelector("#theme-toggle");
  function setTheme(dark) {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    theme.setAttribute(
      "aria-label",
      "Switch to " + (dark ? "light" : "dark") + " theme",
    );
    storage.set("cgear-guide-theme", dark ? "dark" : "light");
  }
  setTheme(storage.get("cgear-guide-theme") === "dark");
  theme.addEventListener("click", () =>
    setTheme(document.documentElement.dataset.theme !== "dark"),
  );
  const search = document.querySelector("#section-search"),
    results = document.querySelector("#search-results");
  search.addEventListener("input", () => {
    results.replaceChildren();
    const q = search.value.trim().toLowerCase();
    results.hidden = !q;
    if (!q) return;
    const matches = sections
      .filter((s) => s.title.toLowerCase().includes(q))
      .slice(0, 6);
    for (const match of matches) {
      const a = document.createElement("a");
      a.href = "#" + match.id;
      a.textContent = match.title;
      a.addEventListener("click", () => {
        results.hidden = true;
        search.value = "";
      });
      results.append(a);
    }
    if (!matches.length) {
      const p = document.createElement("p");
      p.textContent = "No matching section.";
      results.append(p);
    }
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      search.value = "";
      results.hidden = true;
    }
    if (e.key === "Enter") {
      const a = results.querySelector("a");
      if (a) {
        a.click();
        search.blur();
      }
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".header-tools")) results.hidden = true;
  });
  document.querySelectorAll("[data-copy]").forEach((button) =>
    button.addEventListener("click", async () => {
      const text = [
        ...button.closest(".codeplate").querySelectorAll("pre code"),
      ]
        .map((c) => c.textContent)
        .join("\n\n");
      try {
        if (navigator.clipboard && window.isSecureContext)
          await navigator.clipboard.writeText(text);
        else {
          const area = document.createElement("textarea");
          area.value = text;
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.append(area);
          area.select();
          const copied = document.execCommand("copy");
          area.remove();
          if (!copied) throw new Error("copy unavailable");
        }
        button.textContent = "Copied";
      } catch {
        button.textContent = "Select text";
      }
      setTimeout(() => {
        button.textContent = "Copy";
      }, 1800);
    }),
  );
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (!visible.length) return;
        const id = visible[0].target.id;
        document
          .querySelectorAll("#chapter-nav a, #page-toc a")
          .forEach((a) => {
            const active = a.hash === "#" + id;
            a.classList.toggle("active", active);
            if (active) a.setAttribute("aria-current", "location");
            else a.removeAttribute("aria-current");
          });
      },
      { rootMargin: "-85px 0px -65% 0px", threshold: 0 },
    );
    document
      .querySelectorAll("main section[id]")
      .forEach((s) => observer.observe(s));
  }
  const status = document.querySelector("#demo-status"),
    trace = document.querySelector("#demo-trace"),
    busy = document.querySelector("#demo-busy");
  let repel = false;
  function writeTrace(message, lines) {
    status.textContent = message;
    trace.replaceChildren(
      ...lines.map((line) => {
        const li = document.createElement("li");
        li.textContent = line;
        return li;
      }),
    );
  }
  function restoreArt() {
    document.querySelectorAll(".demo-button").forEach((button) => {
      const action = button.dataset.action;
      button.querySelector("img").src =
        `assets/${action}-${action === "repel" && repel ? "active" : "normal"}.png`;
    });
  }
  document.querySelectorAll(".demo-button").forEach((button) =>
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (busy.checked) {
        writeTrace("Native event wins. No action is queued for later.", [
          "The world is blocked.",
          "Discard the custom request.",
          "Release before making another press.",
        ]);
        return;
      }
      if (action === "repel") {
        repel = !repel;
        writeTrace("Unlimited Repel preference: " + (repel ? "on" : "off"), [
          "Capture the REPEL button's slot.",
          "Recheck the field state in QaCGearEvent().",
          "Toggle Options bit 12; later encounter hooks read it.",
        ]);
      } else if (action === "pc")
        writeTrace("Return a native PC script event.", [
          "Capture the PC button's slot.",
          "Create script event 10090; keep its owned VM copy.",
          "Native storage flow owns the menus and cleanup.",
        ]);
      else
        writeTrace("Give an owned request to the native Party application.", [
          "Capture the PARTY button's slot.",
          "A parent event owns FlyWork / MapRequest.",
          "Wait for the native child and handle its return.",
        ]);
      restoreArt();
      button.querySelector("img").src = `assets/${action}-pressed.png`;
      setTimeout(restoreArt, 160);
    }),
  );
  document.querySelector("#demo-reset").addEventListener("click", () => {
    repel = false;
    busy.checked = false;
    restoreArt();
    writeTrace("Choose a button to see its route.", [
      "Artwork and touch targets are ready.",
    ]);
  });
  busy.addEventListener("change", () => {
    if (!busy.checked)
      writeTrace("The world is available. A new press is required.", [
        "Unblocking the game does not replay the discarded request.",
      ]);
  });
})();
