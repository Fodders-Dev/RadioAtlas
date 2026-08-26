import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The privacy policy is the one document in this repo that is only worth having
 * if it is TRUE. A policy that describes an app we used to be is worse than no
 * policy: it is a public, dated, checkable claim about what we do with people's
 * data, and it is the first thing a store reviewer and a suspicious listener
 * both read.
 *
 * The failure it guards is drift. Someone adds a provider — another model
 * vendor, another search backend, another login — the code ships, and the
 * document quietly keeps describing yesterday. Nobody notices, because nothing
 * in the app changes and the page still loads.
 *
 * So this test reads the API's own sources for the processors it actually
 * contacts, and requires the policy to name each one.
 */

const webappRoot = join(import.meta.dirname, '..');
const policyPath = join(webappRoot, 'public', 'privacy.html');
const policy = existsSync(policyPath) ? readFileSync(policyPath, 'utf8') : '';

/** Every .ts under apps/api/src, concatenated. */
const apiSources = (): string => {
  const root = join(webappRoot, '..', 'api', 'src');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) out.push(readFileSync(full, 'utf8'));
    }
  };
  walk(root);
  return out.join('\n');
};

/**
 * Hostname the API talks to → what the policy must name it as. Deliberately a
 * hand-written map: a new entry here is a deliberate decision that a processor
 * exists and has to be disclosed, which is exactly the moment to think about it.
 */
const PROCESSORS: Array<{ host: RegExp; mustMention: RegExp; what: string }> = [
  { host: /api\.telegram\.org/, mustMention: /Telegram/i, what: 'Telegram' },
  { host: /oauth2\.googleapis\.com/, mustMention: /Google/i, what: 'Google login' },
  { host: /oauth\.vk\.com|api\.vk\.com/, mustMention: /VK/, what: 'VK login' },
  { host: /api\.deepseek\.com/, mustMention: /DeepSeek/i, what: 'the DeepSeek model' },
  { host: /api\.openai\.com/, mustMention: /OpenAI/i, what: 'the OpenAI model' },
  { host: /api\.tavily\.com/, mustMention: /Tavily/i, what: 'Tavily web search' },
  { host: /api\.radio-browser\.info/, mustMention: /Radio ?Browser/i, what: 'the Radio Browser catalogue' }
];

describe('the privacy policy exists and still matches the code', () => {
  it('is a page that can actually be served', () => {
    expect(existsSync(policyPath), 'public/privacy.html is missing').toBe(true);
    // Static file, not an SPA route: Caddy serves files but falls through on
    // directories and unknown paths, so a real file is what makes the URL real.
    expect(policy).toMatch(/<title>[^<]*<\/title>/i);
    expect(policy).toMatch(/<link\s+rel="canonical"[^>]*privacy\.html/i);
  });

  it('answers the questions a privacy policy has to answer', () => {
    const required: Array<[string, RegExp]> = [
      ['what is collected', /Что собирается/i],
      ['who it goes to', /Кому данные передаются/i],
      ['how long it is kept', /Сколько хранится/i],
      ['what rights the reader has', /Ваши права/i],
      ['how to make contact', /Связь/i]
    ];
    for (const [label, pattern] of required) {
      expect(policy, `the policy no longer says ${label}`).toMatch(pattern);
    }
  });

  it('names every third party the API actually sends data to', () => {
    const sources = apiSources();
    const missing: string[] = [];
    for (const processor of PROCESSORS) {
      if (!processor.host.test(sources)) continue; // not used any more — fine
      if (!processor.mustMention.test(policy)) missing.push(processor.what);
    }
    expect(
      missing,
      `the API contacts these but the policy does not name them: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('names a real operator and a real contact, not a placeholder', () => {
    // A policy is a legal identification of who holds the data and how to reach
    // them. Shipped half-written it is worse than absent: it looks like an
    // answer, and the one thing a reader needs from it — somebody to write to —
    // is the part that is fake. This page sat uncommitted until both were real.
    expect(policy).not.toMatch(/PLACEHOLDER|example\.com|TODO|ЗАПОЛНИТЬ/i);
    expect(policy, 'no contact address').toMatch(/mailto:[^"@]+@[^"]+/);
    expect(policy, 'no named operator').toMatch(/Оператор сервиса:\s*\S+/);
  });

  it('does not claim we collect nothing, because we do collect some things', () => {
    // The cheap lie a policy drifts into. We hold accounts, libraries and
    // purchases; saying otherwise would be the kind of false claim this
    // project treats as a defect rather than as marketing.
    expect(policy).not.toMatch(/не собира[ею]м никаких данных|мы не храним ничего/i);
  });
});
