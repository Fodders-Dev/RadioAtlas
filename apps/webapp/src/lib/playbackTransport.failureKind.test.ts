import { describe, expect, it } from 'vitest';

import { toPlaybackFailure } from './playbackTransport';

/**
 * Every string in the first block below was taken from production telemetry on
 * 2026-08-18, and every one of them was classified `unknown`. That is why a
 * third of all plays could fail for weeks with nobody able to say why: the
 * counter said `failureKind=unknown`, and the raw `detail` sitting in the very
 * same event said `The operation was aborted.`
 *
 * A failure kind that cannot name the commonest failure is decoration.
 */

const kindOf = (message: string) => toPlaybackFailure(message, { phase: 'play' }).kind;

describe('the browser messages that actually arrive', () => {
  it('names an aborted play instead of shrugging', () => {
    // Someone called load() or pause() over an unsettled play(). Chrome and
    // Safari word it differently and neither matches an internal string.
    expect(kindOf('The operation was aborted.')).toBe('play-failed');
    expect(kindOf('AbortError: The play() request was interrupted by a call to pause().')).toBe(
      'play-failed'
    );
  });

  it('names an unplayable source', () => {
    expect(kindOf('The operation is not supported.')).toBe('unsupported-transport');
    expect(kindOf('NotSupportedError: Failed to load because no supported source was found.')).toBe(
      'unsupported-transport'
    );
    expect(kindOf('media decode error')).toBe('unsupported-transport');
  });

  it('names an autoplay refusal as a play problem, not a dead stream', () => {
    expect(kindOf("NotAllowedError: play() failed because the user didn't interact with the document first.")).toBe(
      'play-failed'
    );
  });

  it('names a network failure', () => {
    expect(kindOf('NetworkError: A network error caused the media download to fail.')).toBe(
      'stream-unavailable'
    );
  });
});

describe('the internal messages keep their existing meaning', () => {
  it('still maps the strings the transport itself raises', () => {
    expect(kindOf('playback superseded')).toBe('superseded');
    expect(kindOf('no playable candidate')).toBe('no-playable-candidate');
    expect(kindOf('media source not supported')).toBe('unsupported-transport');
    expect(kindOf('media network error')).toBe('stream-unavailable');
  });

  it('still lets the plan override the message', () => {
    expect(toPlaybackFailure('whatever', { blockedMixedContent: true }).kind).toBe('mixed-content');
    expect(toPlaybackFailure('whatever', { apiUnavailable: true }).kind).toBe('api-unavailable');
  });

  it('keeps `unknown` for something genuinely unrecognised', () => {
    // The point is not to classify everything — it is to stop classifying the
    // common cases as nothing. A real surprise should still stand out.
    expect(kindOf('the tape reel fell off')).toBe('unknown');
  });
});
