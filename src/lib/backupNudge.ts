// Backup reminder. Receipts, payment requests and cashlink keys live only in
// this device's storage; signing out of Nimiq Pay or clearing site data wipes
// them. After something device-only is created, NimBooks suggests a backup until
// one is copied.
//
// One key, kept out of backups (lib/backup.ts): restoring another device's
// "last backed up" time would silence the reminder here.

export const BACKUP_STATE_KEY = 'nimbooks:backup-state'

interface BackupState {
  /** Last time something device-only was created. */
  changedAt?: number
  /** Last time a backup was copied. */
  backedUpAt?: number
}

function read(): BackupState {
  try {
    const raw = localStorage.getItem(BACKUP_STATE_KEY)
    return raw ? (JSON.parse(raw) as BackupState) : {}
  } catch {
    return {}
  }
}

function write(state: BackupState): void {
  try {
    localStorage.setItem(BACKUP_STATE_KEY, JSON.stringify(state))
  } catch {
    /* storage blocked — the reminder simply doesn't persist */
  }
}

/** A receipt was signed or a cashlink created: there is something new to lose. */
export function markUnbackedChange(): void {
  write({ ...read(), changedAt: Date.now() })
}

/** A backup was copied. */
export function markBackedUp(): void {
  write({ ...read(), backedUpAt: Date.now() })
}

/** True when something device-only was created after the last copied backup. */
export function needsBackup(): boolean {
  const s = read()
  return !!s.changedAt && (!s.backedUpAt || s.backedUpAt < s.changedAt)
}
