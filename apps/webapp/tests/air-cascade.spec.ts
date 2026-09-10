import { test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

/**
 * Ask the browser who wins, instead of reading CSS and hoping.
 *
 * `webapp.md`: the nav's fill is declared in three stylesheets and the player
 * bar's paint is claimed by nine rules across two files, so an edit in the
 * obvious place is silently undone and looks in the diff exactly like a change
 * that worked. `CSS.getMatchedStylesForNode` over CDP lists every matching rule
 * in cascade order with its origin.
 *
 * Diagnostic only — run with AIR_CASCADE=1.
 */
test.skip(process.env.AIR_CASCADE !== '1', 'diagnostic, run with AIR_CASCADE=1');
test.use({ viewport: { width: 390, height: 748 } });

const WATCH = ['.mobile-nav-item', '.home-station-tile-resume'];

const PROPS = new Set([
  'background',
  'background-color',
  'background-image',
  'backdrop-filter',
  '-webkit-backdrop-filter',
  'box-shadow',
  'border',
  'border-radius',
  'color'
]);

test('who paints Home', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('radio:theme-current:v1', JSON.stringify('pastel'));
  });
  await mockStations(page);
  await installMediaMocks(page);
  await seedRadioState(page, {
    queue: [stations[0]],
    queueCurrentIndex: 0,
    stationCache: [stations[0]]
  });
  await page.goto('/?air2=1');
  await page.locator('[data-home-feed-entry]').waitFor({ state: 'visible' });
  await page.waitForTimeout(1200);

  const client = await page.context().newCDPSession(page);
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  const { root } = (await client.send('DOM.getDocument', { depth: -1 })) as any;

  for (const selector of WATCH) {
    const { nodeId } = (await client.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector
    })) as any;
    if (!nodeId) {
      console.log(`\n### ${selector}  — NOT PRESENT`);
      continue;
    }
    const styles = (await client.send('CSS.getMatchedStylesForNode', { nodeId })) as any;
    const lines: string[] = [];
    for (const match of styles.matchedCSSRules || []) {
      const rule = match.rule;
      const origin = rule.styleSheetId ? styles : null;
      const decls = (rule.style?.cssProperties || []).filter((p: any) => PROPS.has(p.name) && p.text);
      if (!decls.length) continue;
      const media = (rule.media || []).map((m: any) => m.text).join(' & ');
      lines.push(
        `  ${rule.selectorList.text}${media ? `  @${media}` : ''}\n` +
          `    ${rule.origin} sheet=${rule.styleSheetId}\n` +
          decls
            .map((d: any) => `      ${d.name}: ${String(d.value).slice(0, 70)}${d.important ? ' !important' : ''}`)
            .join('\n')
      );
    }
    console.log(`\n### ${selector}\n${lines.join('\n') || '  (nothing)'}`);
  }

  // The DOM the overrides have to work with.
  const dom = await page.evaluate(() => {
    const NL = String.fromCharCode(10);
    const dump = (el: Element | null, depth = 0): string[] => {
      if (!el || depth > 3) return [];
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const out = [
        '  '.repeat(depth) +
          el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 44) +
          '  [' + cs.display + ' ' + cs.position + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) +
          ' h=' + cs.height + ' ar=' + cs.aspectRatio + ' ov=' + cs.overflow + ']'
      ];
      for (const child of Array.from(el.children)) out.push(...dump(child, depth + 1));
      return out;
    };
    const tile = document.querySelector('.home-station-tile');
    const nav = document.querySelector('.app-navigation-mobile');
    const up: string[] = [];
    let node: Element | null = tile;
    for (let i = 0; i < 4 && node; i += 1) {
      const cs2 = getComputedStyle(node);
      const r2 = node.getBoundingClientRect();
      up.push(node.tagName.toLowerCase() + '.' + String(node.className).slice(0, 44) +
        '  [' + cs2.display + ' ' + Math.round(r2.width) + 'x' + Math.round(r2.height) +
        ' h=' + cs2.height + ' alignItems=' + cs2.alignItems + ']');
      node = node.parentElement;
    }
    return { tile: dump(tile).join(NL), nav: up.join(NL) };
  });
  console.log('### tile DOM');
  console.log(dom.tile);
  console.log('### nav DOM');
  console.log(dom.nav);

  // Which sheet is which.
  const sheets = await page.evaluate(() =>
    Array.from(document.styleSheets).map((s, i) => `${i}: ${s.href || '(inline)'}`)
  );
  console.log('\n### sheets\n' + sheets.join('\n'));
});
