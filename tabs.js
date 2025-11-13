document.addEventListener("DOMContentLoaded", () => {
    const buttons = document.querySelectorAll(".tab-button");
    const sections = document.querySelectorAll(".tab-section");

    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            buttons.forEach(b => b.classList.remove("active"));
            sections.forEach(s => s.classList.add("hidden"));

            btn.classList.add("active");

            const tab = btn.getAttribute("data-tab");
            document.getElementById(tab).classList.remove("hidden");
        });
    });

    document.querySelector(".tab-button[data-tab='upload']").click();
});
