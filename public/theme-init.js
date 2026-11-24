(function () {
  var choice = "system";
  try {
    var stored = localStorage.getItem("swoony-theme");
    if (stored === "light" || stored === "dark") choice = stored;
  } catch (e) {
    choice = "system";
  }
  var root = document.documentElement;
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  function apply() {
    var dark = choice === "dark" || (choice === "system" && systemDark.matches);
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].content = dark ? "#14101A" : "#FBF9FA";
  }
  apply();
  if (choice === "system" && location.pathname.indexOf("/chat/") !== 0) {
    systemDark.addEventListener("change", apply);
  }
})();
