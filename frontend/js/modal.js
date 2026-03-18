// Modal manager
const Modal = (() => {
  const overlay = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const footerEl = document.getElementById('modal-footer');
  const closeBtn = document.getElementById('modal-close-btn');

  document.getElementById('modal-close-btn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  function open({ title, body, footer = '', wide = false }) {
    titleEl.textContent = title;
    bodyEl.innerHTML = body;
    footerEl.innerHTML = footer || `<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>`;
    overlay.classList.add('open');
    if (wide) overlay.querySelector('.modal').style.maxWidth = '800px';
    else overlay.querySelector('.modal').style.maxWidth = '';
    const firstInput = bodyEl.querySelector('input,textarea,select');
    if (firstInput) setTimeout(() => firstInput.focus(), 100);
  }

  function close() {
    overlay.classList.remove('open');
  }

  closeBtn.addEventListener('click', close);

  return { open, close };
})();
