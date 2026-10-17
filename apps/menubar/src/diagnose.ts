// Why a session recorded nothing, in plain words, with what to do about it. Pure: fed the notes the recorder saved next to the session.
export interface Meta { seen?: number; recorded?: number; secure_skipped?: number; app_unknown?: number; apps_skipped?: { app: string; keys: number }[]; listener_failed?: boolean }
export type Fix = { kind: 'input-settings' } | { kind: 'add-app'; app: string };
export interface Explanation { title: string; lines: string[]; fixes: Fix[] }

export function explainEmpty(meta: Meta | null, health: { listener_failed?: boolean } = {}): Explanation {
  if (health.listener_failed || meta?.listener_failed)
    return { title: 'Merit cannot see your keys', lines: ['macOS has not allowed Merit to watch the keyboard. Turn Merit on under Privacy & Security → Input Monitoring, then quit and reopen Merit.'], fixes: [{ kind: 'input-settings' }] };
  if (!meta)
    return { title: 'Nothing was recorded', lines: ['This session has no notes, so I cannot tell why. Start a new one, type something, and stop it: the notes will show what Merit saw.', 'If a new session also records nothing, Input Monitoring is probably off for Merit.'], fixes: [{ kind: 'input-settings' }] };
  const apps = (meta.apps_skipped ?? []).filter((a) => a.keys > 0);
  const lines: string[] = [];
  const fixes: Fix[] = [];
  if (!(meta.seen ?? 0))
    return { title: 'Merit saw no key presses at all', lines: ['That almost always means macOS Input Monitoring is off for Merit. Turn it on, then quit and reopen Merit and try again.'], fixes: [{ kind: 'input-settings' }] };
  lines.push(`Merit saw ${meta.seen} key presses and recorded none.`);
  if (apps.length) { lines.push(`They were typed in apps that are not on your list: ${apps.slice(0, 4).map((a) => `${a.app} (${a.keys})`).join(', ')}.`); for (const a of apps.slice(0, 4)) fixes.push({ kind: 'add-app', app: a.app }); }
  if (meta.app_unknown) lines.push(`${meta.app_unknown} were typed while Merit could not tell which app was in front.`);
  if (meta.secure_skipped) lines.push(`${meta.secure_skipped} were in a password field, which Merit never measures.`);
  return { title: 'Nothing was recorded', lines, fixes };
}
