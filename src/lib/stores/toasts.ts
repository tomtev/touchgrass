import { writable } from 'svelte/store';

export interface Toast {
  id: string;
  title?: string;
  message: string;
  variant?: 'success' | 'danger' | 'warning';
  duration?: number;
  /** Raw SVG icon string to show before the message */
  icon?: string;
}

export const toasts = writable<Toast[]>([]);

let counter = 0;

export function showToast(
  message: string,
  opts?: { title?: string; variant?: Toast['variant']; duration?: number; icon?: string }
) {
  const id = `toast-${++counter}`;
  const duration = opts?.duration ?? 4000;

  toasts.update((t) => [...t, { id, message, ...opts }]);

  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
}

export function dismissToast(id: string) {
  toasts.update((t) => t.filter((toast) => toast.id !== id));
}
