document.addEventListener("DOMContentLoaded", function () {
  document
    .querySelector('input[name="filter"]')
    .addEventListener("input", function (event) {
      const term = (event.target.value || "").toLocaleLowerCase();
      for (const card of document.querySelectorAll("div.card")) {
        card.classList.toggle(
          "hidden",
          !card.dataset["term"].toLocaleLowerCase().includes(term)
        );
      }
    });
  document.addEventListener("keydown", function (event) {
    if (event.key === "f" && event.ctrlKey) {
      event.preventDefault();
      document.querySelector('input[name="filter"]').focus();
    }
  });
});
