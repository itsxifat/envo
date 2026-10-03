/**
 * Feeds the phone card layout of `.table-base` (see index.css): copies each column's header text
 * into its cells' `data-label`, and marks a cell holding only buttons as the card's action cell.
 * Runs on DOM changes, so pages keep writing plain tables.
 */
function toggle(cell: HTMLTableCellElement | undefined, key: string, on: boolean): void {
  if (!cell) return;
  if (on && !(key in cell.dataset)) cell.dataset[key] = '';
  else if (!on && key in cell.dataset) delete cell.dataset[key];
}

export function startTableCards(root: HTMLElement): () => void {
  let frame = 0;

  const label = () => {
    frame = 0;
    for (const table of root.querySelectorAll<HTMLTableElement>('table.table-base')) {
      const heads = [...table.querySelectorAll<HTMLTableCellElement>('thead th')].map((th) => th.textContent?.trim() ?? '');
      for (const row of table.tBodies[0]?.rows ?? []) {
        // A first column holding only a control (an expand chevron) is no card title: the next
        // cell takes the title role instead.
        const first = row.cells[0];
        const lead = !!first && row.cells.length > 1 && !first.textContent?.trim() && first.querySelector('button, svg') !== null;
        toggle(first, 'lead', lead);
        toggle(row.cells[1], 'title', lead);
        let col = 0;
        for (const cell of row.cells) {
          const text = heads[col] ?? '';
          if (cell.colSpan > 1) {
            col += cell.colSpan;
            continue;
          }
          if (text) {
            if (cell.dataset.label !== text) cell.dataset.label = text;
          } else if (cell.dataset.label) {
            delete cell.dataset.label;
          }
          const onlyControls = !cell.textContent?.trim() && cell.querySelector('button, a') !== null;
          if (onlyControls && col > 0) cell.dataset.actions = '';
          else if ('actions' in cell.dataset) delete cell.dataset.actions;
          col++;
        }
      }
    }
  };

  const observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(label);
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  label();
  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
