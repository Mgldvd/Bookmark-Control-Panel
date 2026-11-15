// Separadores: color propio (clic derecho → «Color del separador…»).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeBookmarks, openPanel } from './helpers/panel.mjs';

/** Barra con la carpeta F: a, separador, b, separador, c. `prefix` cambia los ids (otro perfil). */
function treeWithSeparators(prefix = '') {
  const bm = (id) => ({ id: prefix + id, type: 'bookmark', title: id, url: `https://${id}.example/` });
  const sep = (id) => ({ id: prefix + id, type: 'separator' });
  return {
    id: 'root________',
    type: 'folder',
    children: [
      {
        id: 'toolbar_____',
        type: 'folder',
        title: 'Toolbar',
        children: [
          {
            id: prefix + 'F',
            type: 'folder',
            title: 'F',
            children: [bm('a'), sep('s1'), bm('b'), sep('s2'), bm('c')],
          },
        ],
      },
      { id: 'unfiled_____', type: 'folder', title: 'Other', children: [] },
    ],
  };
}

test('el color de un separador se guarda, se quita y va en la copia de seguridad', async () => {
  const stored = {};
  const env = await openPanel({ stored, bookmarks: fakeBookmarks(treeWithSeparators()) });
  env.panel.setSeparatorColor('s2', 'red');
  await env.flush();
  assert.deepEqual({ ...stored.separatorColors }, { s2: 'red' });

  const backup = env.panel.buildBackup();
  assert.deepEqual({ ...backup.separatorColors }, { s2: 'red' });
  assert.equal(backup.refs.separators.s2.nth, 1, 'segundo separador de su carpeta');

  env.panel.setSeparatorColor('s2', 'no-es-un-color');
  await env.flush();
  assert.deepEqual({ ...stored.separatorColors }, {});
});

test('al importar en otro perfil, el color va al separador de la misma carpeta y posición', async () => {
  const source = await openPanel({ stored: {}, bookmarks: fakeBookmarks(treeWithSeparators()) });
  source.panel.setSeparatorColor('s2', 'teal');
  const backup = JSON.parse(JSON.stringify(source.panel.buildBackup()));

  const other = await openPanel({ stored: {}, bookmarks: fakeBookmarks(treeWithSeparators('x-')) });
  const { values } = other.panel.planImport(backup);
  assert.deepEqual({ ...values.separatorColors }, { 'x-s2': 'teal' });
});

test('el menú de un separador muestra los colores en fila y elegir uno lo aplica', async () => {
  const stored = {};
  const env = await openPanel({ stored, bookmarks: fakeBookmarks(treeWithSeparators()) });
  env.panel.setSeparatorColor('s1', 'blue');
  const items = Array.from(env.panel.separatorMenu(env.panel.get('s1'))).filter((i) => i && i !== '-');
  const row = items[0];
  assert.equal(row.colors, true, 'la primera opción es la fila de colores');
  assert.equal(row.current, 'blue', 'marca el color actual');
  assert.equal(items.at(-1).icon, 'trash');

  row.set('green');
  await env.flush();
  assert.deepEqual({ ...stored.separatorColors }, { s1: 'green' });
  row.set(null);
  await env.flush();
  assert.deepEqual({ ...stored.separatorColors }, {}, 'el último punto quita el color');
});
