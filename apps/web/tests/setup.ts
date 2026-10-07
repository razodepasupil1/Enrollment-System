import "./env";
import "@testing-library/jest-dom/vitest";

// jsdom lacks a few browser APIs that Recharts, Radix and cmdk rely on. These stubs only silence the missing
// layout/measurement features; none of them fakes application behaviour.
class NoopObserver { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView = () => {};
window.print = () => {};
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
