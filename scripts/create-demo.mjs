// Development-only fixture: never included by package.sh.
import fs from 'node:fs';
import { fakeBookmarks } from '../tests/helpers/panel.mjs';

const sets = [
  [
    'daily',
    'Daily essentials',
    [
      'Project overview',
      'Team calendar',
      'Weekly planner',
      'Inbox zero',
      'Focus timer',
      'Meeting notes',
      'Reading queue',
      'Personal notebook',
      'Quick capture',
      'Weather today',
      'Workspace home',
      'Daily inspiration',
    ],
  ],
  [
    'design',
    'Design studio',
    [
      'Color systems',
      'Typography handbook',
      'Interface gallery',
      'Icon collection',
      'Design tokens',
      'Layout inspiration',
      'Accessible patterns',
      'Motion studies',
      'Brand guidelines',
    ],
  ],
  [
    'dev',
    'Development',
    [
      'API reference',
      'CSS field notes',
      'JavaScript guide',
      'Component lab',
      'Release checklist',
      'Code review guide',
      'Performance notes',
      'Testing cookbook',
    ],
  ],
  [
    'learn',
    'Learning',
    [
      'Creative coding',
      'Language practice',
      'Photography basics',
      'History of design',
      'Learning journal',
      'Science weekly',
    ],
  ],
  [
    'read',
    'Reading list',
    [
      'The art of attention',
      'A calmer internet',
      'Designing for everyone',
      'Small tools, big ideas',
      'Notes on creativity',
      'The open web',
      'Good systems',
      'How we learn',
      'Ideas worth keeping',
      'A thoughtful workspace',
    ],
  ],
  [
    'travel',
    'Travel plans',
    [
      'Weekend itinerary',
      'Quiet places',
      'City walking routes',
      'Packing checklist',
      'Train journeys',
      'Local food guide',
      'Travel notebook',
    ],
  ],
  [
    'create',
    'Creative projects',
    [
      'Studio notebook',
      'Sketch collection',
      'Moodboard library',
      'Project Atlas',
      'Portfolio ideas',
      'Creative prompts',
      'Work in progress',
    ],
  ],
  [
    'life',
    'Life & interests',
    ['Recipe collection', 'Garden journal', 'Cycling routes', 'Music discoveries', 'Home projects', 'Film watchlist'],
  ],
];
const folders = sets.map(([id, title, names], f) => ({
  id,
  title,
  children: names.map((name, i) => ({
    id: `${id}-${i}`,
    title: name,
    url: `https://${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.example/`,
    dateAdded: Date.UTC(2026, 10, 12) - (f * 11 + i) * 3600000,
  })),
}));
folders[1].children.push({
  id: 'references',
  title: 'Reference library',
  children: [
    { id: 'reference-1', title: 'Editorial design', url: 'https://editorial.example/' },
    { id: 'reference-2', title: 'Visual storytelling', url: 'https://storytelling.example/' },
  ],
});
const tree = {
  id: 'root________',
  children: [
    { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: folders },
    { id: 'menu________', title: 'Bookmarks Menu', children: [] },
    { id: 'unfiled_____', title: 'Other Bookmarks', children: [] },
  ],
};
const prefs = {
  theme: 'dark',
  lang: 'en',
  homeFolder: 'view:all',
  view: 'board',
  showFavicons: false,
  groupsPanel: false,
  expanded: ['toolbar_____'],
  favorites: ['design-0', 'design-1', 'design-2', 'dev-0', 'dev-1', 'daily-0', 'daily-1', 'read-0'],
  folderColors: {
    daily: 'blue',
    design: 'pink',
    dev: 'teal',
    learn: 'violet',
    read: 'amber',
    travel: 'green',
    create: 'orange',
    life: 'indigo',
  },
  stripFolders: ['daily', 'design', 'dev', 'learn', 'read'],
  masonryFolders: folders.map((f) => f.id),
  stripProfiles: [
    { id: 'work', name: 'Work', color: 'teal', folders: ['daily', 'design', 'dev', 'learn', 'read'] },
    { id: 'personal', name: 'Personal', color: 'pink', folders: ['travel', 'create', 'life'] },
  ],
  stripProfile: 'work',
  stripOpen: ['references'],
  masonryProfiles: [{ id: 'library', name: 'My library', color: 'violet', folders: folders.map((f) => f.id) }],
  masonryProfile: 'library',
  groups: [
    { id: 'launch', name: 'Next launch', color: 'teal', items: ['daily-0', 'dev-0', 'dev-4', 'design-4'] },
    { id: 'ideas', name: 'Ideas to explore', color: 'pink', items: ['design-2', 'read-3', 'create-3', 'learn-0'] },
    { id: 'weekend', name: 'For the weekend', color: 'amber', items: ['travel-0', 'life-0', 'read-0'] },
  ],
};
const script = `// Synthetic data only. No real bookmarks or external requests.\n
const apiBookmarks = (${fakeBookmarks.toString()})(${JSON.stringify(tree)});
const stored = ${JSON.stringify(prefs)};
const scenario = new URLSearchParams(location.search).get('scene') || 'board';
const scenes = {
  board: {}, light: { theme: 'light' },
  grid: { homeFolder: 'daily', view: 'grid', groupsPanel: true },
  list: { homeFolder: 'design', view: 'list', groupsPanel: true },
  strip: { homeFolder: 'view:strip' },
  masonry: { homeFolder: 'view:masonry', theme: 'light' },
  minimal: { homeFolder: 'view:masonry', minimal: true, style: 'glass', bgSource: 'preset', bgPreset: 'aurora' },
  groups: { homeFolder: 'view:favorites', view: 'grid', groupsPanel: true },
  spanish: { homeFolder: 'view:strip', lang: 'es', style: 'sepia', theme: 'light' },
  settings: { homeFolder: 'view:all', style: 'nord', theme: 'light' },
};
Object.assign(stored, scenes[scenario] || {});
localStorage.clear();
localStorage.setItem('bd-theme', stored.theme);
localStorage.setItem('bd-lang', stored.lang);
const listeners = [];
globalThis.browser = {
  bookmarks: apiBookmarks,
  permissions: { getAll: async () => ({data_collection: []}), request: async () => false, onRemoved: {addListener() {}} },
  runtime: { getManifest: () => ({version: '1.16.1'}), getURL: (path) => new URL(path, location.href).href },
  storage: {
    local: {
      get: async (defaults) => ({...defaults, ...structuredClone(stored)}),
      set: async (partial) => {
        const changes = Object.fromEntries(Object.entries(partial).map(([k,v]) => [k,{oldValue:stored[k],newValue:v}]));
        Object.assign(stored, structuredClone(partial));
        listeners.forEach(fn => fn(changes, 'local'));
      },
    },
    onChanged: {addListener: fn => listeners.push(fn)},
  },
  tabs: {create: async () => ({}), getCurrent: async () => ({index:0})},
};
`;
fs.writeFileSync(new URL('../store/demo-data.js', import.meta.url), script);
console.log(
  'Created synthetic demo: ' +
    folders.reduce((n, f) => n + f.children.filter((c) => c.url).length + (f.id === 'design' ? 2 : 0), 0) +
    ' sample items.',
);
