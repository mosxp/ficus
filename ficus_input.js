/* FICUS input helpers: one way to read a press from a mouse, a finger or a pen.
 *
 * Every interaction in Ficus works with both a mouse and a touch screen (iPad first). Most use Pointer Events,
 * which carry mouse, touch and pen alike; the few that listen to TouchEvents need the touch's coordinates, and a
 * couple of browser gestures (double-click, HTML drag and drop) don't come from a finger everywhere. These fill in.
 * Loaded before the other scripts, as window.FicusInput (and getCoordinates, on its own).
 */
(function () {
  "use strict";

  /* Where a press is, in viewport coordinates, from a pointer or mouse event, a TouchEvent (its first touch, or
     with `touchId` that finger; at touchend the finger just lifted) or a Touch. */
  function getCoordinates(event, touchId = null) {
    const touches = event?.touches?.length ? event.touches : event?.changedTouches?.length ? event.changedTouches : null;
    if (touches) {
      const all = touchId == null ? [] : [...touches, ...(event.changedTouches || [])];
      const touch = all.find((t) => t.identifier === touchId) || touches[0];
      return { x: touch.clientX, y: touch.clientY };
    }
    return { x: Number(event?.clientX) || 0, y: Number(event?.clientY) || 0 };
  }

  const DOUBLE_TAP_MS = 350;
  const DOUBLE_TAP_SLOP = 24;

  /* `handler` on a double-click, or on two quick taps with a finger or pen (iOS Safari doesn't send dblclick for
     those). Only once if the browser sends its own dblclick after the taps. Returns a function that unbinds it. */
  function onDoubleActivate(el, handler) {
    let last = null;
    let firedAt = -Infinity;
    const onDbl = (event) => {
      if (performance.now() - firedAt < DOUBLE_TAP_MS * 2) return;
      handler(event);
    };
    const onUp = (event) => {
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      const now = performance.now();
      const { x, y } = getCoordinates(event);
      if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) < DOUBLE_TAP_SLOP) {
        last = null;
        firedAt = now;
        handler(event);
        return;
      }
      last = { t: now, x, y };
    };
    el.addEventListener("dblclick", onDbl);
    el.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("dblclick", onDbl);
      el.removeEventListener("pointerup", onUp);
    };
  }

  /* Reordering a list with a finger or pen, from the grips (`grip`, a selector) inside `list`; a mouse drags rows with
     HTML drag and drop instead, which a finger can't start in every browser. start(handle, event) begins it (false
     to refuse), move({ x, y }) follows it and end({ x, y } or null if cancelled) finishes it. The grips want
     touch-action: none; the page is held still while one is dragged. Returns a function that unbinds it. */
  function bindGripReorder(list, { grip, start, move, end }) {
    let drag = null;
    const onDown = (event) => {
      const handle = event.target.closest?.(grip);
      if (!handle || !list.contains(handle) || event.pointerType === "mouse" || drag) return;
      if (start(handle, event) === false) return;
      event.preventDefault();
      drag = { id: event.pointerId };
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
    };
    const onMove = (event) => {
      if (drag?.id !== event.pointerId) return;
      event.preventDefault();
      move(getCoordinates(event));
    };
    const onEnd = (event) => {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      end(event.type === "pointercancel" ? null : getCoordinates(event));
    };
    const holdStill = (event) => {
      if (drag && event.cancelable) event.preventDefault();
    };
    list.addEventListener("pointerdown", onDown);
    list.addEventListener("pointermove", onMove);
    list.addEventListener("pointerup", onEnd);
    list.addEventListener("pointercancel", onEnd);
    list.addEventListener("touchmove", holdStill, { passive: false });
    return () => {
      list.removeEventListener("pointerdown", onDown);
      list.removeEventListener("pointermove", onMove);
      list.removeEventListener("pointerup", onEnd);
      list.removeEventListener("pointercancel", onEnd);
      list.removeEventListener("touchmove", holdStill);
    };
  }

  window.FicusInput = { getCoordinates, onDoubleActivate, bindGripReorder };
  window.getCoordinates = getCoordinates;
})();
