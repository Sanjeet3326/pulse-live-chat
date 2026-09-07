const MAX_ROTATION_DEGREES = 7;

export function initTilt(root = document) {
  if (window.matchMedia("(hover: none)").matches) return;

  root.querySelectorAll("[data-tilt]").forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const bounds = card.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;

      card.style.transform =
        `perspective(1000px) rotateX(${-y * MAX_ROTATION_DEGREES}deg) ` +
        `rotateY(${x * MAX_ROTATION_DEGREES}deg) translateZ(0)`;

      card.style.setProperty("--glare-x", `${(x + 0.5) * 100}%`);
      card.style.setProperty("--glare-y", `${(y + 0.5) * 100}%`);
      card.classList.add("is-tilting");
    });

    card.addEventListener("pointerleave", () => {
      card.style.transform = "";
      card.classList.remove("is-tilting");
    });
  });
}
