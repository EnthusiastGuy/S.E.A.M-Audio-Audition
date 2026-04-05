MP4 demo export fonts (WOFF2, Latin subset)
==========================================

These files are downloaded from https://fonts.bunny.net (same families as Google Fonts).
Each typeface is licensed under the SIL Open Font License 1.1 (OFL), which permits
bundling and redistribution. See https://scripts.sil.org/OFL

Regenerate after adding/changing the list in:
  _demo/scripts/download-mp4-export-fonts.js
Also refreshes _demo/js/mp4-export-font-manifest.js for the demo font dropdown.
(382 Latin WOFF2 subsets as of the current script.)

Command (from _demo):
  npm run vendor:mp4-fonts
