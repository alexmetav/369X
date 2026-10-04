/* =====================================================================
   369X ICONS
   One line-icon set drawn for 369X: 24px grid, 1.75 stroke, round ends.
   ic("name")          -> inline SVG in the text colour
   ic("name", "g")     -> same icon in the 369X lime -> cyan gradient
   catIcon(catOrIcon)  -> the icon for a market category
   ===================================================================== */
const ICON_PATHS = {
  // menu + actions
  drop: '<path d="M12 3.2s6 6.4 6 10.8a6 6 0 0 1-12 0C6 9.6 12 3.2 12 3.2z"/><path d="M9.2 14.6a2.9 2.9 0 0 0 2.8 2.6"/>',
  portfolio: '<path d="M3 20h18"/><path d="M6 20v-6"/><path d="M11 20V9"/><path d="M16 20v-9"/><path d="M20.5 4.5 16 8l-4-2.5L6.5 9"/>',
  shield: '<path d="M12 3 19 6v5.2c0 4.4-2.9 7.8-7 9.8-4.1-2-7-5.4-7-9.8V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  analytics: '<path d="M3 17.5 9 11.5l4 4 8-8"/><path d="M15 7.5h6v6"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  external: '<path d="M14 3.5h6.5V10"/><path d="M20.5 3.5 11 13"/><path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V7.5A1.5 1.5 0 0 1 5.5 6H10"/>',
  logout: '<path d="M15 3.5h3A2.5 2.5 0 0 1 20.5 6v12a2.5 2.5 0 0 1-2.5 2.5h-3"/><path d="m10 16.5 4.5-4.5L10 7.5"/><path d="M14.5 12H3.5"/>',
  share: '<path d="M12 15V3.5"/><path d="m7.5 8 4.5-4.5L16.5 8"/><path d="M8 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2"/>',
  download: '<path d="M12 3.5V15"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 16.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5"/>',
  x: '<path d="M4 4l16 16M20 4 4 20"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.2 2.8 2.8L16 9.5"/>',
  // features
  coins: '<ellipse cx="9" cy="6.5" rx="6" ry="3"/><path d="M3 6.5v4.5c0 1.7 2.7 3 6 3"/><path d="M3 11v4.5c0 1.7 2.7 3 6 3"/><ellipse cx="15" cy="13.5" rx="6" ry="3"/><path d="M9 13.5V18c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5"/>',
  ballot: '<path d="M7.5 10.5V4.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v6"/><path d="m10 7.2 1.5 1.5 2.7-2.9"/><rect x="3.5" y="10.5" width="17" height="10" rx="2"/><path d="M8 14.5h8"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  tag: '<path d="M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.2 8.2a1.4 1.4 0 0 1 0 2l-6.6 6.6a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.4"/>',
  blocks: '<rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.5"/><rect x="8.25" y="3.5" width="7.5" height="7.5" rx="1.5"/>',
  sprout: '<path d="M12 21v-8.5"/><path d="M12 12.5c0-4.3 3-7.5 8.5-7.5 0 5.4-3.3 7.5-8.5 7.5z"/><path d="M12 15c0-3.3-2.2-5.5-6.5-5.5 0 4.1 2.4 5.5 6.5 5.5z"/>',
  // categories
  crypto: '<path d="M12 2.6 20.2 7.3v9.4L12 21.4l-8.2-4.7V7.3z"/><path d="M9.6 8h3.6a2 2 0 0 1 0 4H9.6zm0 4h4.1a2 2 0 0 1 0 4H9.6z"/><path d="M9.6 8v8"/><path d="M11.2 6.6V8M11.2 16v1.4"/>',
  sports: '<circle cx="12" cy="12" r="9"/><path d="m12 8 3.1 2.3-1.2 3.6h-3.8l-1.2-3.6z"/><path d="M12 8V3.2M15.1 10.3l4.5-1.5M13.9 13.9l2.8 3.8M10.1 13.9l-2.8 3.8M8.9 10.3 4.4 8.8"/>',
  politics: '<path d="M3 20.5h18"/><path d="M5.5 20.5v-9M10 20.5v-9M14 20.5v-9M18.5 20.5v-9"/><path d="M3 9 12 4l9 5z"/>',
  finance: '<path d="M7 3.5v3.5M7 15v5.5"/><rect x="5" y="7" width="4" height="8" rx="1"/><path d="M17 4v5M17 17v3.5"/><rect x="15" y="9" width="4" height="8" rx="1"/>',
  culture: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.2 9.4v5.2l4.5-2.6z"/>',
  world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.4 2.6 3.7 5.6 3.7 9s-1.3 6.4-3.7 9c-2.4-2.6-3.7-5.6-3.7-9S9.6 5.6 12 3z"/>',
  // badges
  flame: '<path d="M12 21c4 0 7-2.8 7-6.7 0-3.3-2.3-5.6-3.9-7.6-.6 1.9-1.6 3.1-3 3.6.4-3-1-5.8-3.5-7.6.3 3-1.5 4.8-3 6.9C4.6 11.4 5 12.8 5 14.3 5 18.2 8 21 12 21z"/>',
  rocket: '<path d="M9.5 14.5 6.6 11.6C8 7.7 11.6 3.5 20.5 3.5c0 8.9-4.2 12.5-8.1 13.9z"/><circle cx="15" cy="9" r="1.6"/><path d="M6.6 11.6H3.5l2.7-3.3h4M12.4 17.4v3.1l3.3-2.7v-4M6 15.5c-1.4.6-2.2 2.7-2.5 5 2.3-.3 4.4-1.1 5-2.5"/>',
  bolt: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
  waves: '<path d="M3 9c3 0 3-2.5 6-2.5S12 9 15 9s3-2.5 6-2.5"/><path d="M3 14c3 0 3-2.5 6-2.5s3 2.5 6 2.5 3-2.5 6-2.5"/><path d="M3 19c3 0 3-2.5 6-2.5s3 2.5 6 2.5 3-2.5 6-2.5"/>',
  vault: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5v-1M12 16.5v-1M8.5 12h-1M16.5 12h-1M6.5 19.5v1.5M17.5 19.5v1.5"/>',
  diamond: '<path d="M6.5 3.5h11l3.5 5.5-9 11.5L3 9z"/><path d="M3 9h18"/><path d="m9.5 3.5-1.5 5.5 4 11.5 4-11.5-1.5-5.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>'
};

function ic(name, cls = ""){
  const p = ICON_PATHS[name] || ICON_PATHS.world;
  return `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${p}</svg>`;
}

// market icons: stored as a category name (older data may still hold an emoji)
const CAT_ICON = { Crypto: "crypto", Sports: "sports", Politics: "politics", Finance: "finance", Culture: "culture", World: "world" };
const LEGACY_ICON = { "₿": "crypto", "Ξ": "crypto", "◆": "crypto", "◎": "crypto", "⚽": "sports", "🏀": "sports", "🏏": "sports", "🗳": "politics", "🏛": "finance",
  "📈": "finance", "🎮": "culture", "🎬": "culture", "🌍": "world", "🚀": "world" };
const catIcon = (v, cls = "g") => ic(CAT_ICON[v] || LEGACY_ICON[v] || "world", cls);
