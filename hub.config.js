/* Centar DEVA hub: identity, tokens, labels, file lists. No figures and no navigation here (those are in data/). */
window.HUB_CONFIG = {
  id: 'devacentar', title: 'Centar DEVA · Hub', lang: 'en', locale: 'en-GB', currency: 'RSD',
  home: '/overview', theme: 'auto',
  brand: { name: 'Centar DEVA', sub: 'Hub' },
  tokens: { accent: '#B05A47', accentSoft: '#F3E6E1' }, tokensDark: { accent: '#E09A86', accentSoft: '#3A2823' },
  storage: { prefix: 'devacentar-hub' },
  skin: 'skin.css?v=a5dea58fe9',
  modules: ['tables', 'page-frame'],
  data: ['data/core.js', 'data/website.js'],
  views: ['views.js', 'trail.js'],
  // the assistant (tools/assistant): on the published hub it talks to Cloud Run and only answers signed-in members;
  // on a local preview it uses the server on this Mac (127.0.0.1:8790)
  after: ['assistant.js?v=e029087e6f', 'website-changes.js?v=eb0a5fea4a', 'tasks.js?v=8084eeefef'],
  assistant: { endpoint: 'https://hub-assistant-165052418454.europe-west1.run.app/chat' },
  gate: { scripts: ['firebase-config.js?v=6a430abc89', 'chassis/gate-store.js'], keyDoc: 'hubs/devacentar/meta/gate', roles: ['admin', 'team'] },
  labels: { filter: 'Filter the menu', staleItem: 'That item is no longer in this hub.', gateTitle: 'Centar DEVA hub' }
};
