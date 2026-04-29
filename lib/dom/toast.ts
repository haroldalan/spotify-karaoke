let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, durationMs = 0): void {
  let toast = document.getElementById('sly-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sly-toast';
    toast.className = 'sly-toast';
    document.body.appendChild(toast);
  }

  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');

  if (durationMs > 0) {
    toastTimer = setTimeout(() => hideToast(), durationMs);
  }
}

export function hideToast(skipIfTimed = false): void {
  const toast = document.getElementById('sly-toast');
  if (!toast) return;
  if (skipIfTimed && toastTimer !== null) return;
  toast.classList.remove('visible');
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}
