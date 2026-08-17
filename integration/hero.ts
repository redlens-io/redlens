import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/**
 * The hero animation for the store page.
 *
 * The listing has never had one, and it is the highest-leverage thing on the
 * page: the still images explain features to somebody already reading, while the
 * hero has to answer "what is this" to somebody who has not decided to read yet.
 *
 * Three deliberate constraints:
 *
 *  · **Beats, not motion.** This is a held slideshow — one frame per state,
 *    two and a half seconds each — rather than a screen recording. A recording
 *    of a headless workbench is mostly cursor-less dead time, it is an order of
 *    magnitude larger, and nothing in the flow actually benefits from seeing the
 *    intermediate pixels. Five clear states read better than fifty blurred ones.
 *  · **Free features only.** This runs the open package standalone, so nothing
 *    here needs a licence — which is also the honest thing to put at the top of
 *    a page where the first call to action is a free install.
 *  · **Cropped to the product.** Same reasoning as the still gallery: the window
 *    chrome carries the dev host title and the host's Sign In button, and it
 *    sits outside the product, so removing it costs nothing and hides nothing.
 */

const OUT_DIR = '/app/build/hero';
const FRAME_DIR = `${OUT_DIR}/frames`;

/** Crop geometry, in the captured 1280x1024 canvas. Matches the still gallery's
 *  origin so the hero and the screenshots below it look like one set. */
const CROP = { x: 40, y: 150, w: 1180, h: 620 };

/** How long each beat holds, in hundredths of a second (ImageMagick's unit). */
const HOLD = 250;

let frame = 0;

function beat(label: string): void {
  const file = path.join(FRAME_DIR, `${String(frame).padStart(2, '0')}.png`);
  execSync(`import -window root ${file}`, { env: process.env });
  execSync(`convert ${file} -crop ${CROP.w}x${CROP.h}+${CROP.x}+${CROP.y} +repage ${file}`);
  const px = execSync(`identify -format '%wx%h' ${file}`).toString();
  if (px !== `${CROP.w}x${CROP.h}`) {
    // A silent crop failure would publish the whole dev-host window, title bar
    // and all, as the first thing anyone sees of this product.
    throw new Error(`hero frame ${frame} (${label}) cropped to ${px}, expected ${CROP.w}x${CROP.h}`);
  }
  console.error(`hero frame ${frame} — ${label}`);
  frame++;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Leave exactly one thing open in the editor area, keeping the sidebar.
 *
 * `closeEditorsInOtherGroups` keeps whichever group is ACTIVE, and a panel that
 * opens without taking focus is not it — which is how the last beat ended up
 * photographing the SQL tab instead of the masked grid it exists to show. So the
 * editors are closed first and the panel opened into an empty area: no guessing
 * about focus, and the panel gets the full width either way.
 */
async function onlyEditor(open: () => Thenable<unknown>, settleMs: number): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(400);
  await open();
  await sleep(settleMs);
  await quiet();
}

/** The query this hero is about, in a fresh untitled editor. */
const HERO_SQL = [
  'SELECT e.eventname, sum(s.pricepaid) AS revenue',
  'FROM tickit.sales s',
  'JOIN tickit.event e ON e.eventid = s.eventid',
  'GROUP BY e.eventname',
  'ORDER BY revenue DESC;',
  '',
].join('\n');

async function openQuery(): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: HERO_SQL });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
}

async function quiet(): Promise<void> {
  for (const id of ['workbench.action.closeAuxiliaryBar', 'workbench.action.closePanel', 'notifications.clearAll']) {
    try {
      await vscode.commands.executeCommand(id);
    } catch {
      /* absent in this workbench; the capture is still worth taking */
    }
  }
  await sleep(300);
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension('lensql.redlens');
  if (ext === undefined) {
    throw new Error('extension not found');
  }
  await ext.activate();

  fs.rmSync(FRAME_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAME_DIR, { recursive: true });

  await vscode.workspace.getConfiguration('redlens').update(
    'connections',
    [{
      id: 'demohero', name: 'Demo (tickit fixtures)', kind: 'demo',
      host: 'demo', port: 1, database: 'tickit', username: 'demo', ssl: false,
    }],
    vscode.ConfigurationTarget.Global,
  );
  await vscode.commands.executeCommand('redlens.connectToProfile', 'demohero');
  await sleep(800);
  await quiet();

  // 1. Connected, with the warehouse in the tree. "It knows my Redshift."
  await vscode.commands.executeCommand('workbench.view.extension.redlens');
  await sleep(2500);
  await quiet();
  beat('explorer — the warehouse, connected');

  // 2. A query in the editor. "I write SQL here."
  await openQuery();
  await sleep(1800);
  beat('editor — SQL, with the schema behind it');

  // 3. Results. "And it runs."
  //
  //    `soloEditor` before every panel beat, and it is not cosmetic: with the
  //    SQL tab still open the workbench splits into three columns and the panel
  //    gets about four hundred pixels. That clipped the masked column out of the
  //    PII frame and the fix advice out of the plan — in both cases removing the
  //    one thing the beat exists to show. The sidebar stays, because a layout
  //    that jumps between frames of a five-second loop reads as broken.
  await onlyEditor(() => vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table',
    table: { schema: 'tickit', name: 'sales', kind: 'table' },
  }), 2800);
  beat('grid — results you can work in');

  // 4. The plan, with the warnings that are the whole point. "It knows what
  //    Redshift will do badly, not just what the SQL says."
  //    The plan gets the full width, and the SQL does not stay beside it: at
  //    1180px the advice wrapped past the right edge mid-sentence, and the beat
  //    immediately before this one is the query itself — the sequence already
  //    puts them together without the frame having to.
  //    The query is opened FRESH rather than reused: closing all editors for the
  //    previous beat disposes an untitled document, and reopening the handle
  //    gives back an empty buffer — which had EXPLAIN explaining nothing at all.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(400);
  await openQuery();
  await sleep(900);
  await vscode.commands.executeCommand('redlens.explainQuery');
  await sleep(3000);
  // The plan opens in the group to the right; focus it, then drop the rest.
  await vscode.commands.executeCommand('workbench.action.focusRightGroup');
  await sleep(300);
  await vscode.commands.executeCommand('workbench.action.closeEditorsInOtherGroups');
  await sleep(900);
  await quiet();
  beat('explain — warehouse-aware warnings');

  // 5. PII-safe mode. The last thing seen is the promise that costs nothing:
  //    every safety feature is free, and always will be.
  await vscode.workspace.getConfiguration('redlens').update('piiSafeMode', true, vscode.ConfigurationTarget.Global);
  await onlyEditor(() => vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table',
    table: { schema: 'tickit', name: 'users', kind: 'table' },
  }), 2800);
  beat('pii-safe mode — masked by default, free forever');

  if (frame < 5) {
    throw new Error(`only ${frame} hero frames were captured`);
  }

  // Assemble. `-layers optimize` stores only what changes between frames, which
  // matters here precisely because the sidebar is identical in all five.
  const gif = path.join(OUT_DIR, 'hero.gif');
  execSync(
    `convert -delay ${HOLD} -loop 0 ${FRAME_DIR}/*.png -layers optimize -colors 128 ${gif}`,
    { env: process.env },
  );
  const bytes = fs.statSync(gif).size;
  console.error(`hero.gif — ${frame} frames, ${(bytes / 1024).toFixed(0)} KB, ${CROP.w}x${CROP.h}`);
  // A store page that hangs on its own hero is worse than one without a hero.
  if (bytes > 3_000_000) {
    throw new Error(`hero.gif is ${(bytes / 1024 / 1024).toFixed(1)} MB — too heavy for a listing`);
  }
  console.error('HERO_OK');
}
