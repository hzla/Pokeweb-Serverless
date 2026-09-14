/** Run once per element as it approaches the viewport, including new rows. */
export function observeNearViewport(root: HTMLElement, selector: string, load: (element: HTMLElement) => void): () => void {
  let active = true;
  const completed = new WeakSet<Element>();
  const pending = new Set<Element>();
  const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!active || completed.has(entry.target) || !entry.isIntersecting || !root.contains(entry.target)) continue;
      observer?.unobserve(entry.target);
      pending.delete(entry.target);
      completed.add(entry.target);
      load(entry.target as HTMLElement);
    }
  }, { rootMargin: "256px" });

  const observe = (element: HTMLElement): void => {
    if (completed.has(element) || pending.has(element) || !root.contains(element)) return;
    if (observer) {
      pending.add(element);
      observer.observe(element);
    } else {
      completed.add(element);
      load(element);
    }
  };
  const visit = (node: Node, callback: (element: HTMLElement) => void): void => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(selector)) callback(node);
    node.querySelectorAll<HTMLElement>(selector).forEach(callback);
  };
  const mutations = new MutationObserver((records) => {
    if (!active) return;
    // Inspect only changed subtrees; autocomplete and panel edits should not
    // rescan every trainer and Pokémon image on the page.
    for (const record of records) for (const node of record.removedNodes) visit(node, (element) => {
      observer?.unobserve(element);
      pending.delete(element);
    });
    for (const record of records) for (const node of record.addedNodes) visit(node, observe);
  });
  mutations.observe(root, { childList: true, subtree: true });
  root.querySelectorAll<HTMLElement>(selector).forEach(observe);
  return () => {
    active = false;
    observer?.disconnect();
    mutations.disconnect();
    pending.clear();
  };
}
