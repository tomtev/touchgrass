/** Svelte action: portals a tooltip to document.body so it isn't clipped by overflow. */
export function tooltip(node: HTMLElement, text: string | undefined) {
  let tip: HTMLDivElement | null = null;
  let current = text;

  function show() {
    if (!current) return;
    tip = document.createElement('div');
    tip.className = 'portal-tooltip';
    tip.textContent = current;
    document.body.appendChild(tip);

    const rect = node.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    tip.style.left = `${rect.right + 14}px`;
    tip.style.top = `${rect.top + rect.height / 2 - tipRect.height / 2}px`;
  }

  function hide() {
    if (tip) {
      tip.remove();
      tip = null;
    }
  }

  node.addEventListener('mouseenter', show);
  node.addEventListener('mouseleave', hide);

  return {
    update(newText: string | undefined) {
      current = newText;
      if (tip) {
        if (!current) {
          hide();
        } else {
          tip.textContent = current;
        }
      }
    },
    destroy() {
      hide();
      node.removeEventListener('mouseenter', show);
      node.removeEventListener('mouseleave', hide);
    },
  };
}

/** Same as tooltip but positioned below the element. */
export function tooltipBottom(node: HTMLElement, text: string | undefined | null) {
  let tip: HTMLDivElement | null = null;
  let current = text;

  function show() {
    if (!current) return;
    tip = document.createElement('div');
    tip.className = 'portal-tooltip';
    tip.textContent = current;
    document.body.appendChild(tip);

    const rect = node.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    tip.style.left = `${rect.left + rect.width / 2 - tipRect.width / 2}px`;
    tip.style.top = `${rect.bottom + 6}px`;
  }

  function hide() {
    if (tip) {
      tip.remove();
      tip = null;
    }
  }

  node.addEventListener('mouseenter', show);
  node.addEventListener('mouseleave', hide);

  return {
    update(newText: string | undefined | null) {
      current = newText;
      if (tip) {
        if (!current) {
          hide();
        } else {
          tip.textContent = current;
        }
      }
    },
    destroy() {
      hide();
      node.removeEventListener('mouseenter', show);
      node.removeEventListener('mouseleave', hide);
    },
  };
}
