/**
 * Downloads Latin WOFF2 subsets from fonts.bunny.net (SIL OFL / compatible licenses).
 * Run from _demo: node scripts/download-mp4-export-fonts.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'fonts', 'export');
const cssPath = path.join(root, 'css', 'mp4-export-fonts.css');

/** Latin 400 normal WOFF2 — verified Bunny paths */
const fonts = [
  { id: 'bebas-neue', file: 'bebas-neue-latin-400-normal.woff2', family: 'SEAM-Export-Bebas-Neue', label: 'Bebas Neue' },
  { id: 'oswald', file: 'oswald-latin-400-normal.woff2', family: 'SEAM-Export-Oswald', label: 'Oswald' },
  { id: 'rajdhani', file: 'rajdhani-latin-400-normal.woff2', family: 'SEAM-Export-Rajdhani', label: 'Rajdhani' },
  { id: 'orbitron', file: 'orbitron-latin-400-normal.woff2', family: 'SEAM-Export-Orbitron', label: 'Orbitron' },
  { id: 'exo-2', file: 'exo-2-latin-400-normal.woff2', family: 'SEAM-Export-Exo-2', label: 'Exo 2' },
  { id: 'teko', file: 'teko-latin-400-normal.woff2', family: 'SEAM-Export-Teko', label: 'Teko' },
  { id: 'anton', file: 'anton-latin-400-normal.woff2', family: 'SEAM-Export-Anton', label: 'Anton' },
  { id: 'righteous', file: 'righteous-latin-400-normal.woff2', family: 'SEAM-Export-Righteous', label: 'Righteous' },
  { id: 'fredoka', file: 'fredoka-latin-400-normal.woff2', family: 'SEAM-Export-Fredoka', label: 'Fredoka' },
  { id: 'sora', file: 'sora-latin-400-normal.woff2', family: 'SEAM-Export-Sora', label: 'Sora' },
  { id: 'outfit', file: 'outfit-latin-400-normal.woff2', family: 'SEAM-Export-Outfit', label: 'Outfit' },
  { id: 'dm-sans', file: 'dm-sans-latin-400-normal.woff2', family: 'SEAM-Export-DM-Sans', label: 'DM Sans' },
  { id: 'archivo-narrow', file: 'archivo-narrow-latin-400-normal.woff2', family: 'SEAM-Export-Archivo-Narrow', label: 'Archivo Narrow' },
  { id: 'barlow-condensed', file: 'barlow-condensed-latin-400-normal.woff2', family: 'SEAM-Export-Barlow-Condensed', label: 'Barlow Condensed' },
  { id: 'raleway', file: 'raleway-latin-400-normal.woff2', family: 'SEAM-Export-Raleway', label: 'Raleway' },
  { id: 'montserrat', file: 'montserrat-latin-400-normal.woff2', family: 'SEAM-Export-Montserrat', label: 'Montserrat' },
  { id: 'libre-franklin', file: 'libre-franklin-latin-400-normal.woff2', family: 'SEAM-Export-Libre-Franklin', label: 'Libre Franklin' },
  { id: 'manrope', file: 'manrope-latin-400-normal.woff2', family: 'SEAM-Export-Manrope', label: 'Manrope' },
  { id: 'jetbrains-mono', file: 'jetbrains-mono-latin-400-normal.woff2', family: 'SEAM-Export-JetBrains-Mono', label: 'JetBrains Mono' },
  { id: 'space-mono', file: 'space-mono-latin-400-normal.woff2', family: 'SEAM-Export-Space-Mono', label: 'Space Mono' },
  { id: 'inter', file: 'inter-latin-400-normal.woff2', family: 'SEAM-Export-Inter', label: 'Inter' },
  { id: 'poppins', file: 'poppins-latin-400-normal.woff2', family: 'SEAM-Export-Poppins', label: 'Poppins' },
  { id: 'nunito', file: 'nunito-latin-400-normal.woff2', family: 'SEAM-Export-Nunito', label: 'Nunito' },
  { id: 'rubik', file: 'rubik-latin-400-normal.woff2', family: 'SEAM-Export-Rubik', label: 'Rubik' },
  { id: 'work-sans', file: 'work-sans-latin-400-normal.woff2', family: 'SEAM-Export-Work-Sans', label: 'Work Sans' },
  { id: 'playfair-display', file: 'playfair-display-latin-400-normal.woff2', family: 'SEAM-Export-Playfair-Display', label: 'Playfair Display' },
  { id: 'lora', file: 'lora-latin-400-normal.woff2', family: 'SEAM-Export-Lora', label: 'Lora' },
  { id: 'merriweather', file: 'merriweather-latin-400-normal.woff2', family: 'SEAM-Export-Merriweather', label: 'Merriweather' },
  { id: 'source-sans-3', file: 'source-sans-3-latin-400-normal.woff2', family: 'SEAM-Export-Source-Sans-3', label: 'Source Sans 3' },
  { id: 'bitter', file: 'bitter-latin-400-normal.woff2', family: 'SEAM-Export-Bitter', label: 'Bitter' },
  { id: 'cabin', file: 'cabin-latin-400-normal.woff2', family: 'SEAM-Export-Cabin', label: 'Cabin' },
  { id: 'bungee', file: 'bungee-latin-400-normal.woff2', family: 'SEAM-Export-Bungee', label: 'Bungee' },
  { id: 'audiowide', file: 'audiowide-latin-400-normal.woff2', family: 'SEAM-Export-Audiowide', label: 'Audiowide' },
  { id: 'share-tech', file: 'share-tech-latin-400-normal.woff2', family: 'SEAM-Export-Share-Tech', label: 'Share Tech' },
  { id: 'vt323', file: 'vt323-latin-400-normal.woff2', family: 'SEAM-Export-VT323', label: 'VT323' },
  { id: 'press-start-2p', file: 'press-start-2p-latin-400-normal.woff2', family: 'SEAM-Export-Press-Start-2P', label: 'Press Start 2P' },
  { id: 'syncopate', file: 'syncopate-latin-400-normal.woff2', family: 'SEAM-Export-Syncopate', label: 'Syncopate' },
  { id: 'maven-pro', file: 'maven-pro-latin-400-normal.woff2', family: 'SEAM-Export-Maven-Pro', label: 'Maven Pro' },
  { id: 'quantico', file: 'quantico-latin-400-normal.woff2', family: 'SEAM-Export-Quantico', label: 'Quantico' },
  { id: 'ubuntu', file: 'ubuntu-latin-400-normal.woff2', family: 'SEAM-Export-Ubuntu', label: 'Ubuntu' },
  /* Handwriting / script (OFL) */
  { id: 'caveat', file: 'caveat-latin-400-normal.woff2', family: 'SEAM-Export-Caveat', label: 'Caveat' },
  { id: 'dancing-script', file: 'dancing-script-latin-400-normal.woff2', family: 'SEAM-Export-Dancing-Script', label: 'Dancing Script' },
  { id: 'pacifico', file: 'pacifico-latin-400-normal.woff2', family: 'SEAM-Export-Pacifico', label: 'Pacifico' },
  { id: 'shadows-into-light', file: 'shadows-into-light-latin-400-normal.woff2', family: 'SEAM-Export-Shadows-Into-Light', label: 'Shadows Into Light' },
  { id: 'indie-flower', file: 'indie-flower-latin-400-normal.woff2', family: 'SEAM-Export-Indie-Flower', label: 'Indie Flower' },
  { id: 'kalam', file: 'kalam-latin-400-normal.woff2', family: 'SEAM-Export-Kalam', label: 'Kalam' },
  { id: 'permanent-marker', file: 'permanent-marker-latin-400-normal.woff2', family: 'SEAM-Export-Permanent-Marker', label: 'Permanent Marker' },
  { id: 'architects-daughter', file: 'architects-daughter-latin-400-normal.woff2', family: 'SEAM-Export-Architects-Daughter', label: 'Architects Daughter' },
  { id: 'satisfy', file: 'satisfy-latin-400-normal.woff2', family: 'SEAM-Export-Satisfy', label: 'Satisfy' },
  { id: 'great-vibes', file: 'great-vibes-latin-400-normal.woff2', family: 'SEAM-Export-Great-Vibes', label: 'Great Vibes' },
  { id: 'sacramento', file: 'sacramento-latin-400-normal.woff2', family: 'SEAM-Export-Sacramento', label: 'Sacramento' },
  { id: 'give-you-glory', file: 'give-you-glory-latin-400-normal.woff2', family: 'SEAM-Export-Give-You-Glory', label: 'Give You Glory' },
  /* Comic / cartoon */
  { id: 'comic-neue', file: 'comic-neue-latin-400-normal.woff2', family: 'SEAM-Export-Comic-Neue', label: 'Comic Neue' },
  { id: 'bangers', file: 'bangers-latin-400-normal.woff2', family: 'SEAM-Export-Bangers', label: 'Bangers' },
  { id: 'chewy', file: 'chewy-latin-400-normal.woff2', family: 'SEAM-Export-Chewy', label: 'Chewy' },
  { id: 'freckle-face', file: 'freckle-face-latin-400-normal.woff2', family: 'SEAM-Export-Freckle-Face', label: 'Freckle Face' },
  { id: 'bowlby-one', file: 'bowlby-one-latin-400-normal.woff2', family: 'SEAM-Export-Bowlby-One', label: 'Bowlby One' },
  { id: 'luckiest-guy', file: 'luckiest-guy-latin-400-normal.woff2', family: 'SEAM-Export-Luckiest-Guy', label: 'Luckiest Guy' },
  { id: 'butterfly-kids', file: 'butterfly-kids-latin-400-normal.woff2', family: 'SEAM-Export-Butterfly-Kids', label: 'Butterfly Kids' },
  { id: 'irish-grover', file: 'irish-grover-latin-400-normal.woff2', family: 'SEAM-Export-Irish-Grover', label: 'Irish Grover' },
  /* Pixel / monospace CRT */
  { id: 'silkscreen', file: 'silkscreen-latin-400-normal.woff2', family: 'SEAM-Export-Silkscreen', label: 'Silkscreen' },
  { id: 'pixelify-sans', file: 'pixelify-sans-latin-400-normal.woff2', family: 'SEAM-Export-Pixelify-Sans', label: 'Pixelify Sans' },
  { id: 'dotgothic16', file: 'dotgothic16-latin-400-normal.woff2', family: 'SEAM-Export-DotGothic16', label: 'DotGothic16' },
  /* Funky / horror / display */
  { id: 'creepster', file: 'creepster-latin-400-normal.woff2', family: 'SEAM-Export-Creepster', label: 'Creepster' },
  { id: 'monoton', file: 'monoton-latin-400-normal.woff2', family: 'SEAM-Export-Monoton', label: 'Monoton' },
  { id: 'bungee-shade', file: 'bungee-shade-latin-400-normal.woff2', family: 'SEAM-Export-Bungee-Shade', label: 'Bungee Shade' },
  { id: 'rubik-dirt', file: 'rubik-dirt-latin-400-normal.woff2', family: 'SEAM-Export-Rubik-Dirt', label: 'Rubik Dirt' },
  { id: 'rubik-bubbles', file: 'rubik-bubbles-latin-400-normal.woff2', family: 'SEAM-Export-Rubik-Bubbles', label: 'Rubik Bubbles' },
  { id: 'ewert', file: 'ewert-latin-400-normal.woff2', family: 'SEAM-Export-Ewert', label: 'Ewert' },
  { id: 'nosifer', file: 'nosifer-latin-400-normal.woff2', family: 'SEAM-Export-Nosifer', label: 'Nosifer' },
];

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          download(res.headers.location).then(resolve).catch(reject);
          res.resume();
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const cssLines = [
    '/* Auto-generated by npm run vendor:mp4-fonts — SIL Open Font License (OFL) fonts via fonts.bunny.net */',
    '/* See fonts/export/README.txt */',
    '',
  ];

  for (const f of fonts) {
    const url = `https://fonts.bunny.net/${f.id}/files/${f.file}`;
    const dest = path.join(outDir, `${f.id}.woff2`);
    process.stdout.write(`${f.label}… `);
    const buf = await download(url);
    fs.writeFileSync(dest, buf);
    console.log(`${(buf.length / 1024).toFixed(1)} KB`);

    cssLines.push(`@font-face {`);
    cssLines.push(`  font-family: '${f.family}';`);
    cssLines.push(`  font-style: normal;`);
    cssLines.push(`  font-weight: 400;`);
    cssLines.push(`  font-display: swap;`);
    cssLines.push(`  src: url('../fonts/export/${f.id}.woff2') format('woff2');`);
    cssLines.push(`}`);
    cssLines.push('');
  }

  fs.writeFileSync(cssPath, cssLines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${cssPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
