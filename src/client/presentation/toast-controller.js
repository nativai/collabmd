export class ToastController {
  constructor(container) {
    this.container = container;
  }

  show(message, duration = 3000) {
    if (!this.container) {
      return;
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    this.container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('leaving');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, duration);
  }
}
