import assert from 'node:assert/strict';
import test from 'node:test';
import { publicWebSources } from '../src/ai/publicSources.js';

test('publicWebSources never exposes private snippets, raw lyrics, or ranking scores', () => {
  const sources = publicWebSources([
    {
      title: 'Song lyrics',
      url: 'https://lyrics.example/song',
      snippet: 'private cleaned full page text',
      score: 0.98,
      publishedDate: '2026-07-20'
    }
  ]);

  assert.deepEqual(sources, [
    {
      title: 'Song lyrics',
      url: 'https://lyrics.example/song',
      publishedDate: '2026-07-20'
    }
  ]);
  assert.equal('snippet' in sources[0]!, false);
  assert.equal('score' in sources[0]!, false);
});
