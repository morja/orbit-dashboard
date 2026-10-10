/* Keep long paths on one line while retaining the start and end of their location. */
const context = document.createElement('canvas').getContext('2d');

export function fitProjectPaths() {
  for (const node of document.querySelectorAll('.project-path')) {
    if (!node.clientWidth) continue;
    const path = node.dataset.displayPath;
    context.font = getComputedStyle(node).font;
    const fits = text => context.measureText(text).width <= node.clientWidth - 1;
    if (fits(path)) {
      node.textContent = path;
      continue;
    }
    const characters = Array.from(path);
    const shortened = length => {
      const head = Math.ceil(length / 2);
      const tail = Math.floor(length / 2);
      return characters.slice(0, head).join('') + '…' + characters.slice(characters.length - tail).join('');
    };
    let low = 0;
    let high = characters.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(shortened(middle))) low = middle;
      else high = middle - 1;
    }
    node.textContent = shortened(low);
  }
}

export function bindPathLayout() {
  const observer = new ResizeObserver(fitProjectPaths);
  observer.observe(document.getElementById('content'));
}
