/* Short confirmation and error messages at the bottom of the window. */

let timer;

export function notify(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => { toast.hidden = true; }, 3500);
}
