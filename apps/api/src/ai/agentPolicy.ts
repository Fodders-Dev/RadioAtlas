import type {
  AssistantAction,
  ChatInput,
  ChatResult
} from './types.js';

export type ToolPermission = 'read' | 'write' | 'approval_required' | 'denied';

export type PermissionDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
};

const ACTION_PERMISSIONS: Record<AssistantAction['kind'], ToolPermission> = {
  play: 'write',
  'open-station': 'read',
  enqueue: 'write',
  'set-favorite': 'write',
  pause: 'write',
  none: 'read'
};

export const evaluateToolPermission = (
  permission: ToolPermission,
  approvalGranted = false
): PermissionDecision => {
  if (permission === 'denied') {
    return { allowed: false, requiresApproval: false, reason: 'tool_denied' };
  }
  if (permission === 'approval_required' && !approvalGranted) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: 'approval_required'
    };
  }
  return { allowed: true, requiresApproval: false };
};

const stationAction = (action: AssistantAction) =>
  action.kind === 'play' ||
  action.kind === 'open-station' ||
  action.kind === 'enqueue' ||
  action.kind === 'set-favorite';

export type ActionPolicyResult = {
  actions: AssistantAction[];
  warnings: string[];
};

export const applyAssistantActionPolicy = (
  actions: AssistantAction[],
  result: Pick<ChatResult, 'stations'>,
  input: ChatInput,
  runId: string
): ActionPolicyResult => {
  const groundedStationIds = new Set([
    ...result.stations.map((station) => station.stationuuid),
    ...(input.nowPlaying?.stationUuid ? [input.nowPlaying.stationUuid] : [])
  ]);
  const warnings: string[] = [];
  const accepted: AssistantAction[] = [];
  const signatures = new Set<string>();

  for (const action of actions.slice(0, 3)) {
    if (
      input.surface === 'telegram' &&
      (action.kind === 'enqueue' || action.kind === 'set-favorite' || action.kind === 'pause')
    ) {
      warnings.push(`${action.kind}:unsupported_surface`);
      continue;
    }
    const permission = ACTION_PERMISSIONS[action.kind];
    const decision = evaluateToolPermission(permission);
    if (!decision.allowed) {
      warnings.push(`${action.kind}:${decision.reason || 'denied'}`);
      continue;
    }
    if (stationAction(action)) {
      if (!action.stationuuid || !groundedStationIds.has(action.stationuuid)) {
        warnings.push(`${action.kind}:ungrounded_station`);
        continue;
      }
    }
    if (action.kind === 'set-favorite' && typeof action.desired !== 'boolean') {
      warnings.push('set-favorite:desired_required');
      continue;
    }
    const signature = `${action.kind}:${action.stationuuid || ''}:${String(action.desired)}`;
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    accepted.push({
      ...action,
      actionId: `${runId}:${accepted.length + 1}`,
      permission: permission === 'write' ? 'write' : 'read'
    });
  }

  return {
    actions: accepted.length ? accepted : [{ kind: 'none', permission: 'read' }],
    warnings
  };
};

export type VerificationResult = {
  passed: boolean;
  errors: string[];
};

export const verifyAgentResult = (
  result: ChatResult,
  input: ChatInput
): VerificationResult => {
  const errors: string[] = [];
  if (!result.reply.trim()) errors.push('reply_empty');
  if (result.reply.length > 12_000) errors.push('reply_too_long');

  const seenStations = new Set<string>();
  for (const station of result.stations) {
    if (!station.stationuuid || !station.name || !station.url_resolved) {
      errors.push('station_invalid');
      continue;
    }
    if (seenStations.has(station.stationuuid)) errors.push('station_duplicate');
    seenStations.add(station.stationuuid);
  }

  const groundedIds = new Set([
    ...seenStations,
    ...(input.nowPlaying?.stationUuid ? [input.nowPlaying.stationUuid] : [])
  ]);
  for (const action of result.actions) {
    if (stationAction(action) && (!action.stationuuid || !groundedIds.has(action.stationuuid))) {
      errors.push(`action_ungrounded:${action.kind}`);
    }
    if (action.kind === 'set-favorite' && typeof action.desired !== 'boolean') {
      errors.push('action_invalid:set-favorite');
    }
  }

  return { passed: errors.length === 0, errors };
};
