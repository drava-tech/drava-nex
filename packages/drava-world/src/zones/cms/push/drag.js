// Dragging things around the console with the pointer (media and screens from the library,
// screens between edges, layouts onto screens), as Push does for touch: past a few pixels a
// copy of the thing follows the pointer, and on release it lands on whatever is under it.
// (Pointer events rather than HTML drag and drop, which a page placed in 3D on the kiosk
// can't be relied on for.)

const SLOP = 6;
let suppressClick = 0;

/** True for a moment after a drag ends, so the click that follows it is ignored. */
export const justDragged = () => Date.now() < suppressClick;

/**
 * Start watching a press on `from`. opts:
 *   ghost()               the element to show under the pointer (a clone of `from` by default)
 *   over(el, x, y)        while dragging, what is under the pointer
 *   drop(el, x, y)        released over el
 *   click()               released without dragging
 */
export function startDrag(e, from, { ghost = null, over = () => {}, drop = () => {}, click = null } = {}) {
  if (e.button !== 0) return;
  const sx = e.clientX, sy = e.clientY;
  let g = null;
  const move = (ev) => {
    if (!g) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < SLOP) return;
      const r = from.getBoundingClientRect();
      g = ghost?.() ?? from.cloneNode(true);
      g.classList.add('pc-ghost');
      Object.assign(g.style, { width: `${r.width}px`, height: `${r.height}px` });
      document.body.append(g);
      document.body.classList.add('dragging');
    }
    g.style.transform = `translate(${ev.clientX - g.offsetWidth / 2}px, ${ev.clientY - g.offsetHeight / 2}px)`;
    over(document.elementFromPoint(ev.clientX, ev.clientY), ev.clientX, ev.clientY);
  };
  const up = (ev) => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', cancel);
    if (!g) { click?.(); return; }
    g.remove();
    document.body.classList.remove('dragging');
    suppressClick = Date.now() + 300;
    over(null);
    drop(document.elementFromPoint(ev.clientX, ev.clientY), ev.clientX, ev.clientY);
  };
  const cancel = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', cancel);
    g?.remove();
    document.body.classList.remove('dragging');
    over(null);
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', cancel);
}

/** Highlight one element with `cls`, clearing it from the rest. */
export function mark(cls, el) {
  document.querySelectorAll(`.${cls}`).forEach((x) => { if (x !== el) x.classList.remove(cls); });
  el?.classList.add(cls);
}

/** The nearest of the canvas's edges to a point inside it. */
export function nearestEdge(canvas, x, y) {
  const r = canvas.getBoundingClientRect();
  return [['left', x - r.left], ['right', r.right - x], ['top', y - r.top]].sort((a, b) => a[1] - b[1])[0][0];
}
