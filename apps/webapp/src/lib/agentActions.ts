import type { ChatActionReceipt, ChatActionRef } from './aiChat';

type ResolvedStation = { stationuuid: string; url_resolved?: string };

export type AgentActionHandlers<TStation extends ResolvedStation> = {
  resolveStation: (stationuuid: string) => Promise<TStation | null>;
  play: (station: TStation) => void;
  enqueue: (station: TStation) => boolean;
  pause: () => void;
  isFavorite: (stationuuid: string) => boolean;
  toggleFavorite: (station: TStation) => void;
};

const receipt = (
  action: ChatActionRef,
  index: number,
  status: ChatActionReceipt['status'],
  detail?: string
): ChatActionReceipt => ({
  actionId: action.actionId || `legacy:${index}`,
  kind: action.kind,
  status,
  ...(action.stationuuid ? { stationuuid: action.stationuuid } : {}),
  ...(detail ? { detail } : {})
});

const needsStation = (action: ChatActionRef): action is ChatActionRef & { stationuuid: string } =>
  typeof action.stationuuid === 'string' && Boolean(action.stationuuid.trim());

/**
 * Narrow client tool registry. The server can propose an action; only this
 * switch is allowed to mutate player state. Unknown, ungrounded and explicitly
 * read-only actions fail closed and produce a receipt for the next agent turn.
 */
export const executeAgentActions = async <TStation extends ResolvedStation>(
  actions: ChatActionRef[],
  handlers: AgentActionHandlers<TStation>
): Promise<ChatActionReceipt[]> => {
  const receipts: ChatActionReceipt[] = [];
  for (const [index, action] of actions.slice(0, 3).entries()) {
    try {
      if (action.kind === 'none' || action.kind === 'open-station') {
        receipts.push(receipt(action, index, 'skipped', 'render_only'));
        continue;
      }
      if (action.permission === 'read') {
        receipts.push(receipt(action, index, 'failed', 'write_permission_missing'));
        continue;
      }
      if (action.kind === 'pause') {
        handlers.pause();
        receipts.push(receipt(action, index, 'executed'));
        continue;
      }
      if (!needsStation(action)) {
        receipts.push(receipt(action, index, 'failed', 'station_missing'));
        continue;
      }
      const station = await handlers.resolveStation(action.stationuuid).catch(() => null);
      if (!station) {
        receipts.push(receipt(action, index, 'failed', 'station_unverified'));
        continue;
      }
      if (action.kind === 'play') {
        if (!station.url_resolved) {
          receipts.push(receipt(action, index, 'failed', 'stream_missing'));
          continue;
        }
        handlers.play(station);
        receipts.push(receipt(action, index, 'executed'));
        continue;
      }
      if (action.kind === 'enqueue') {
        const added = handlers.enqueue(station);
        receipts.push(receipt(action, index, added ? 'executed' : 'skipped', added ? undefined : 'already_queued'));
        continue;
      }
      if (action.kind === 'set-favorite') {
        if (typeof action.desired !== 'boolean') {
          receipts.push(receipt(action, index, 'failed', 'desired_state_missing'));
          continue;
        }
        if (handlers.isFavorite(station.stationuuid) === action.desired) {
          receipts.push(receipt(action, index, 'skipped', 'already_in_desired_state'));
          continue;
        }
        handlers.toggleFavorite(station);
        receipts.push(receipt(action, index, 'executed'));
        continue;
      }
      receipts.push(receipt(action, index, 'failed', 'unsupported_action'));
    } catch {
      receipts.push(receipt(action, index, 'failed', 'client_execution_failed'));
    }
  }
  return receipts;
};
