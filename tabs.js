// Simple, resilient tab switcher
document.addEventListener("DOMContentLoaded", () => {
  const buttons  = document.querySelectorAll(".tab-btn");
  const sections = document.querySelectorAll(".tab-content");

  function show(id){
    sections.forEach(s => s.classList.toggle("active", s.id === id));
    buttons.forEach(b => b.classList.toggle("active", b.dataset.target === id));
  }

  // Wire up clicks
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.target;
      show(id);

      // refresh categories when entering Upload or View
      if (["upload-section","view-section"].includes(id) && window.loadCategories){
        window.loadCategories();
      }
    });
  });

  // First paint: ensure only one is visible
  show("upload-section");
  if (window.loadCategories) window.loadCategories();
});
