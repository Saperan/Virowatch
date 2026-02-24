(function () {
  var toggle = document.querySelector('.app-sidebar-toggle');
  var overlay = document.querySelector('.app-sidebar-overlay');

  function closeSidebar() {
    document.body.classList.remove('app-sidebar-open');
  }

  function toggleSidebar() {
    document.body.classList.toggle('app-sidebar-open');
  }

  if (toggle) {
    toggle.addEventListener('click', toggleSidebar);
  }
  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }
})();
