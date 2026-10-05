/** Keep full cards near the viewport while preserving every row's scroll slot. */
export function installPokemonCardViewport(
  root: HTMLElement,
  render: (card: HTMLElement) => void,
  onDisconnect: () => void,
): () => void {
  const list = root.querySelector<HTMLElement>("#personals");
  if (!list) return () => {};
  let active = true;
  const mounted = new Set<HTMLElement>();
  const nearby = new Set<HTMLElement>();
  const cards = [...list.querySelectorAll<HTMLElement>(".pokemon-card")];
  const listeners = new AbortController();

  const mount = (card: HTMLElement): void => {
    if (!active || mounted.has(card) || !list.contains(card) || card.style.display === "none") return;
    render(card);
    card.classList.remove("pokemon-card-placeholder");
    card.removeAttribute("aria-hidden");
    mounted.add(card);
  };
  const release = (card: HTMLElement): void => {
    // Keep edits and panel state alive even when their row scrolls out of view.
    if (!mounted.has(card) || card.contains(document.activeElement) || card.querySelector(".expanded-card-content.show-flex")) return;
    const height = card.getBoundingClientRect().height;
    if (height > 0) card.style.setProperty("--pokemon-card-height", `${height}px`);
    card.replaceChildren();
    card.classList.add("pokemon-card-placeholder");
    card.setAttribute("aria-hidden", "true");
    mounted.delete(card);
  };

  const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver((entries) => {
    if (!active) return;
    // Release old cards before rendering the destination of a large scroll.
    for (const entry of entries) {
      if (entry.isIntersecting) continue;
      const card = entry.target as HTMLElement;
      nearby.delete(card);
      release(card);
    }
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const card = entry.target as HTMLElement;
      nearby.add(card);
      mount(card);
    }
  }, { root: root.closest("#content-container"), rootMargin: "800px 0px" });

  // A focused row can become releasable after its pending edit is committed.
  root.addEventListener("focusout", () => {
    queueMicrotask(() => {
      if (active && observer) for (const card of mounted) if (!nearby.has(card)) release(card);
    });
  }, { signal: listeners.signal });

  let width: number | undefined;
  const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(([entry]) => {
    if (!active || !entry || entry.contentRect.width === width) return;
    if (width !== undefined) for (const card of cards) card.style.removeProperty("--pokemon-card-height");
    width = entry.contentRect.width;
  });
  resize?.observe(list);

  const disconnect = (): void => {
    if (!active) return;
    active = false;
    observer?.disconnect();
    resize?.disconnect();
    removal.disconnect();
    listeners.abort();
    mounted.clear();
    nearby.clear();
    onDisconnect();
  };
  // The app reuses this root for other routes. Drop observers and callbacks as
  // soon as this editor leaves it, rather than retaining the previous list.
  const removal = new MutationObserver(() => {
    if (!root.contains(list)) disconnect();
  });
  removal.observe(root, { childList: true });
  for (const card of cards) {
    if (observer) observer.observe(card);
    else mount(card);
  }
  return disconnect;
}
