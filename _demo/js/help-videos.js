(function () {
  function camelCaseFileStemToTitle(stem) {
    if (!stem) return "";
    var s = stem.replace(/([a-z\d])([A-Z])/g, "$1 $2");
    s = s.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
    return s.replace(/\s+/g, " ").trim();
  }

  function fileNameToTitle(filename) {
    var stem = filename.replace(/\.[^/.]+$/, "");
    return camelCaseFileStemToTitle(stem);
  }

  function mimeForFilename(name) {
    var lower = name.toLowerCase();
    if (lower.endsWith(".mp4")) return "video/mp4";
    if (lower.endsWith(".webm")) return "video/webm";
    if (lower.endsWith(".ogg") || lower.endsWith(".ogv")) return "video/ogg";
    return "video/x-matroska";
  }

  function build() {
    var list = document.getElementById("help-video-tutorials-list");
    if (!list) return;

    var files = Array.isArray(window.__SEAM_HELP_VIDEOS) ? window.__SEAM_HELP_VIDEOS : [];
    list.innerHTML = "";

    if (!files.length) {
      var empty = document.createElement("p");
      empty.className = "help-video-empty";
      empty.textContent = "No tutorial videos in this build.";
      list.appendChild(empty);
      return;
    }

    files.forEach(function (filename) {
      var titleText = fileNameToTitle(filename);
      var src = "video/" + encodeURI(filename);

      var block = document.createElement("div");
      block.className = "help-video-block";

      var h = document.createElement("h4");
      h.className = "help-video-title";
      h.textContent = titleText;

      var embed = document.createElement("div");
      embed.className = "help-video-embed";

      var video = document.createElement("video");
      video.setAttribute("controls", "");
      video.setAttribute("preload", "metadata");
      video.setAttribute("playsinline", "");
      video.setAttribute("aria-label", titleText);

      var source = document.createElement("source");
      source.src = src;
      source.type = mimeForFilename(filename);
      video.appendChild(source);

      embed.appendChild(video);

      var fallback = document.createElement("p");
      fallback.className = "help-video-fallback";
      fallback.appendChild(document.createTextNode("If the browser cannot play this file, download: "));
      var dl = document.createElement("a");
      dl.href = src;
      dl.setAttribute("download", filename);
      dl.textContent = filename;
      fallback.appendChild(dl);
      fallback.appendChild(document.createTextNode("."));

      block.appendChild(h);
      block.appendChild(embed);
      block.appendChild(fallback);
      list.appendChild(block);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
