/* Centar DEVA hub: identity, tokens, labels, file lists. No figures and no navigation here (those are in data/). */
window.HUB_CONFIG = {
  id: 'devacentar', title: 'Centar DEVA · Hub', lang: 'en', locale: 'en-GB', currency: 'RSD',
  home: '/overview', theme: 'auto',
  brand: { name: 'Centar DEVA', sub: 'Hub' },
  tokens: { accent: '#B05A47', accentSoft: '#F3E6E1' }, tokensDark: { accent: '#E09A86', accentSoft: '#3A2823' },
  storage: { prefix: 'devacentar-hub' },
  skin: 'skin.css?v=16064d51d7',
  modules: ['tables', 'page-frame'],
  data: ['data/core.js', 'data/website.js', 'data/brand-files.js', 'data/docs.js'],   // brand-files.js: brand/embed.py (the Brand downloads)
  views: ['views.js', 'trail.js'],
  // the assistant (tools/assistant): on the published hub it talks to Cloud Run and only answers signed-in members;
  // on a local preview it uses the server on this Mac (127.0.0.1:8790)
  after: ['assistant.js?v=5b8ebef626', 'website-changes.js?v=5744389510', 'tasks.js?v=3ca9d6a042', 'work-log.js?v=f062920f3e', 'costs.js?v=91a61595f4'],
  assistant: { endpoint: 'https://hub-assistant-165052418454.europe-west1.run.app/chat' },
  gate: { scripts: ['firebase-config.js?v=6a430abc89', 'chassis/gate-store.js'], keyDoc: 'hubs/devacentar/meta/gate', roles: ['admin', 'team'] },
  labels: { filter: 'Filter the menu', staleItem: 'That item is no longer in this hub.', gateTitle: 'Centar DEVA hub' }
};
