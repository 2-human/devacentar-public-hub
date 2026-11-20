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
  // local prototype: the assistant (assistant.js does nothing on a non-local page; see tasks/todo.md)
  after: ['assistant.js?v=cbda227bae'],
  gate: { scripts: ['firebase-config.js?v=6a430abc89', 'chassis/gate-store.js'], keyDoc: 'hubs/devacentar/meta/gate', roles: ['admin', 'team'] },
  labels: { filter: 'Filter the menu', staleItem: 'That item is no longer in this hub.', gateTitle: 'Centar DEVA hub' }
};
