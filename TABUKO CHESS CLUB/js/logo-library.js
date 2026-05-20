/**
 * logo-library.js
 * Contains the foundational logos for the Tabuko Team Logo System.
 * Generates an SVG library dynamically to save space.
 */

const LogoLibrary = (() => {
  // Base SVG Shapes to mix and match
  const SHAPES = {
    shield: '<path d="M50 5 L90 20 L90 50 C90 80 50 95 50 95 C50 95 10 80 10 50 L10 20 Z" />',
    hexagon: '<polygon points="50,5 95,25 95,75 50,95 5,75 5,25" />',
    diamond: '<polygon points="50,5 95,50 50,95 5,50" />',
    circle: '<circle cx="50" cy="50" r="45" />',
    crest: '<path d="M20 10 L80 10 L80 60 C80 80 50 95 50 95 C50 95 20 80 20 60 Z" />'
  };

  const ICONS = {
    knight: '<path d="M40 30 C30 30 25 40 25 50 L35 50 C35 45 40 40 50 45 C50 45 45 35 40 30 M50 45 L60 60 L75 60 L60 30 C50 20 40 25 40 30" fill="#fff"/>',
    rook: '<path d="M30 20 L30 40 L40 40 L40 30 L45 30 L45 40 L55 40 L55 30 L60 30 L60 40 L70 40 L70 20 Z M35 45 L65 45 L70 80 L30 80 Z" fill="#fff"/>',
    king: '<path d="M45 10 L55 10 L55 20 L65 20 L65 30 L55 30 L55 40 L45 40 L45 30 L35 30 L35 20 L45 20 Z M30 45 L70 45 L75 80 L25 80 Z" fill="#fff"/>',
    dragon: '<path d="M20 50 Q40 20 70 30 Q60 50 80 60 Q50 80 30 60 Q40 50 20 50 Z" fill="#fff"/>', // Abstract dragon
    wolf: '<polygon points="30,30 40,50 50,40 60,50 70,30 65,70 50,80 35,70" fill="#fff"/>',
    falcon: '<path d="M10 50 Q50 10 90 50 L50 80 Z M30 50 L50 30 L70 50 Z" fill="#fff"/>',
    sword: '<polygon points="45,10 55,10 55,60 65,60 65,70 55,70 55,90 45,90 45,70 35,70 35,60 45,60" fill="#fff"/>',
    crown: '<polygon points="20,40 35,20 50,30 65,20 80,40 70,70 30,70" fill="#fff"/>',
    star: '<polygon points="50,15 61,35 82,35 65,49 71,70 50,57 29,70 35,49 18,35 39,35" fill="#fff"/>',
    lightning: '<polygon points="55,10 30,50 50,50 45,90 70,40 50,40" fill="#fff"/>',
    ph_sun: '<circle cx="50" cy="50" r="15" fill="#fff"/><path d="M50 10 L55 30 L45 30 Z M50 90 L55 70 L45 70 Z M90 50 L70 55 L70 45 Z M10 50 L30 55 L30 45 Z M20 20 L35 30 L25 40 Z M80 80 L65 70 L75 60 Z M80 20 L65 30 L75 40 Z M20 80 L35 70 L25 60 Z" fill="#fff"/>' // 8 rays abstract
  };

  const CATEGORIES = ['tactical', 'esports', 'academic', 'neon', 'philippine'];
  const RARITIES = ['common', 'rare', 'epic', 'legendary'];
  const PALETTES = [
    { p: '#00f2ff', s: '#1a1a2e' }, // Cyan
    { p: '#ff003c', s: '#2a0a18' }, // Crimson
    { p: '#9EFF00', s: '#111c05' }, // Neon Green
    { p: '#FFB800', s: '#2e1f00' }, // Gold
    { p: '#b026ff', s: '#1e0533' }, // Violet
    { p: '#ffffff', s: '#0f172a' }, // Titanium
    { p: '#f97316', s: '#2c1404' }, // Amber
    { p: '#ec4899', s: '#2b0b1a' }  // Pink
  ];

  // Procedural generator to get 200 logos
  let _logos = null;

  function generateLibrary() {
    if (_logos) return _logos;
    _logos = [];

    const shapeKeys = Object.keys(SHAPES);
    const iconKeys = Object.keys(ICONS);
    
    let idCounter = 1;

    // Generate logos by mixing shapes, icons, and colors
    for (let i = 0; i < 200; i++) {
      const shapeName = shapeKeys[i % shapeKeys.length];
      const iconName = iconKeys[(i * 3) % iconKeys.length];
      const category = CATEGORIES[i % CATEGORIES.length];
      const palette = PALETTES[(i * 7) % PALETTES.length];
      
      let rarity = 'common';
      if (i % 10 === 0) rarity = 'legendary';
      else if (i % 5 === 0) rarity = 'epic';
      else if (i % 2 === 0) rarity = 'rare';

      // Build SVG String
      const svgString = `
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="grad_${idCounter}" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="${palette.p}" stop-opacity="0.8"/>
              <stop offset="100%" stop-color="${palette.s}" stop-opacity="0.9"/>
            </linearGradient>
            <filter id="glow_${idCounter}" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over"/>
            </filter>
          </defs>
          <g filter="url(#glow_${idCounter})">
            <!-- Base Shape -->
            <g fill="url(#grad_${idCounter})" stroke="${palette.p}" stroke-width="2">
              ${SHAPES[shapeName]}
            </g>
            <!-- Inner Icon -->
            <g transform="scale(0.8) translate(12.5, 12.5)">
              ${ICONS[iconName]}
            </g>
          </g>
        </svg>
      `;

      // Build Monochrome SVG
      const monochromeSvg = svgString
        .replace(/url\(#grad_\d+\)/g, '#334155')
        .replace(/stroke="[^"]+"/g, 'stroke="#64748b"')
        .replace(/fill="#fff"/g, 'fill="#94a3b8"');

      // Build Mini SVG (no filters)
      const miniSvg = `
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <g fill="${palette.p}">
            ${SHAPES[shapeName]}
          </g>
          <g transform="scale(0.8) translate(12.5, 12.5)" fill="#000">
            ${ICONS[iconName]}
          </g>
        </svg>
      `;

      _logos.push({
        id: `logo_${idCounter.toString().padStart(3, '0')}`,
        name: generateName(category, iconName, palette.p),
        category: category,
        rarity: rarity,
        primaryColor: palette.p,
        secondaryColor: palette.s,
        svg: svgString,
        monochrome: monochromeSvg,
        miniIcon: miniSvg
      });

      idCounter++;
    }

    return _logos;
  }

  function generateName(category, iconName, color) {
    const adjectives = {
      '#00f2ff': ['Cyber', 'Neon', 'Frost', 'Quantum'],
      '#ff003c': ['Blood', 'Crimson', 'Inferno', 'Sith'],
      '#9EFF00': ['Toxic', 'Venom', 'Bio', 'Acid'],
      '#FFB800': ['Golden', 'Royal', 'Solar', 'Imperial'],
      '#b026ff': ['Void', 'Cosmic', 'Astral', 'Phantom'],
      '#ffffff': ['Ghost', 'Silver', 'Iron', 'Titanium'],
      '#f97316': ['Ember', 'Blaze', 'Scorch', 'Forge'],
      '#ec4899': ['Lotus', 'Neon', 'Synth', 'Pixel']
    };
    
    const nouns = {
      knight: 'Knights', rook: 'Rooks', king: 'Kings',
      dragon: 'Dragons', wolf: 'Wolves', falcon: 'Falcons',
      sword: 'Blades', crown: 'Royals', star: 'Stars',
      lightning: 'Strike', ph_sun: 'Suns'
    };

    const adjList = adjectives[color] || ['Shadow', 'Dark', 'Elite'];
    const adj = adjList[Math.floor(Math.random() * adjList.length)];
    const noun = nouns[iconName] || 'Squad';

    return `${adj} ${noun}`;
  }

  return {
    getLogos: generateLibrary,
    getLogoById: (id) => generateLibrary().find(l => l.id === id),
    getRandomLogo: () => {
      const lib = generateLibrary();
      return lib[Math.floor(Math.random() * lib.length)];
    }
  };
})();

window.LogoLibrary = LogoLibrary;
