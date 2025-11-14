// tabs.js - simple tab switching
console.log("tabs.js loaded");

document.querySelectorAll(".tab-button").forEach(btn => {
    btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;

        document.querySelectorAll(".tab-section").forEach(sec => sec.classList.add("hidden"));
        document.getElementById(tab).classList.remove("hidden");

        document.querySelectorAll(".tab-button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
    });
});
